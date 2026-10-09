/**
 * System 1 Training Repository
 *
 * Supplies labelled training samples (embedding + features + label) for the
 * System 1 heads.
 *
 * Labels come from two honest sources only:
 * - gold: what the user did (moved the mail, accepted/edited a suggestion,
 *   overrode the triage, marked a reply done or "not important");
 * - teacher: what System 2 (the LLM) answered, from `email_signals`.
 * Gold wins when both exist. Never read from here: `email_embeddings.folder`
 * (LLM pseudo-labels and 'INBOX' placeholders), System 1's own signals, or
 * fallback results.
 *
 * Features are rebuilt exactly as the decorator builds them at inference.
 * The "prior replies to this sender" count only includes mail I sent BEFORE
 * the email in question, otherwise my own reply to it would leak the label.
 */

import Database from 'better-sqlite3';
import type { System1TrainingRepo } from '../../core/ports';
import { buildFeatures } from '../../core/system1/features';
import { EMAIL_QUESTIONS, type TrainingSample } from '../../core/system1/types';

type Label = { label: string; gold: boolean };

/** `YYYY-MM-DD HH:MM:SS` (SQLite default, UTC) or ISO-8601 to epoch ms; 0 when unparsable. */
function parseTime(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const time = Date.parse(normalised);
  return Number.isNaN(time) ? 0 : time;
}

function parseRecipients(json: unknown): string[] {
  if (typeof json !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): string[] => {
      if (typeof entry === 'string') return [entry];
      const address = (entry as { address?: unknown } | null)?.address;
      return typeof address === 'string' ? [address] : [];
    });
  } catch {
    return [];
  }
}

function decodeEmbedding(blob: unknown): Float32Array | null {
  // `isView` rather than `instanceof`: it also holds across realms (jsdom test environment).
  if (!ArrayBuffer.isView(blob) || blob.byteLength === 0 || blob.byteLength % 4 !== 0) {
    return null;
  }
  // Copy: a Buffer from better-sqlite3 may sit at an unaligned offset of a shared pool.
  const bytes = new Uint8Array(blob.byteLength);
  bytes.set(new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength));
  return new Float32Array(bytes.buffer);
}

const FOLDER_SET = new Set<string>(EMAIL_QUESTIONS.folder.options);

const CHUNK = 500;

type SignalRow = {
  email_id: number;
  source: 'user' | 'system2';
  needs_reply: number | null;
  importance: number | null;
};

function folderLabels(db: Database.Database): Map<number, Label> {
  type Row = { email_id: number; folder: string; created_at: string };
  const goldRows: Row[] = [
    ...(db
      .prepare(
        `SELECT email_id, user_choice AS folder, created_at FROM training_examples
         WHERE email_id IS NOT NULL ORDER BY id`,
      )
      .all() as Row[]),
    ...(db
      .prepare(
        `SELECT email_id, final_folder AS folder, created_at FROM classification_feedback
         WHERE final_folder IS NOT NULL ORDER BY id`,
      )
      .all() as Row[]),
    ...(db
      .prepare(
        `SELECT email_id, final_folder AS folder, created_at FROM triage_log
         WHERE source = 'user-override' AND final_folder IS NOT NULL ORDER BY id`,
      )
      .all() as Row[]),
  ];

  const labels = new Map<number, Label>();
  const goldTime = new Map<number, number>();
  for (const row of goldRows) {
    if (!FOLDER_SET.has(row.folder)) continue;
    const time = parseTime(row.created_at);
    // The most recent user action wins; later rows win ties.
    if (time >= (goldTime.get(row.email_id) ?? -1)) {
      goldTime.set(row.email_id, time);
      labels.set(row.email_id, { label: row.folder, gold: true });
    }
  }

  const teacherRows = db
    .prepare(
      `SELECT email_id, folder FROM email_signals WHERE source = 'system2' AND folder IS NOT NULL`,
    )
    .all() as { email_id: number; folder: string }[];
  for (const row of teacherRows) {
    if (FOLDER_SET.has(row.folder) && !labels.has(row.email_id)) {
      labels.set(row.email_id, { label: row.folder, gold: false });
    }
  }
  return labels;
}

function signalLabels(
  db: Database.Database,
  pick: (row: SignalRow) => string | null,
): Map<number, Label> {
  const rows = db
    .prepare(
      `SELECT email_id, source, needs_reply, importance FROM email_signals
       WHERE source IN ('user', 'system2')`,
    )
    .all() as SignalRow[];

  const labels = new Map<number, Label>();
  for (const row of rows) {
    const label = pick(row);
    if (label === null) continue;
    const gold = row.source === 'user';
    const existing = labels.get(row.email_id);
    if (!existing || (gold && !existing.gold)) labels.set(row.email_id, { label, gold });
  }
  return labels;
}

function labelsFor(db: Database.Database, questionId: string): Map<number, Label> | null {
  switch (questionId) {
    case EMAIL_QUESTIONS.folder.id:
      return folderLabels(db);
    case EMAIL_QUESTIONS.needsReply.id:
      return signalLabels(db, (row) =>
        row.needs_reply === null ? null : Number(row.needs_reply) >= 0.5 ? 'true' : 'false',
      );
    case EMAIL_QUESTIONS.importance.id:
      return signalLabels(db, (row) => (row.importance === null ? null : String(row.importance)));
    default:
      return null;
  }
}

/** Times (ms, ascending) at which I wrote to each (account, recipient). */
function sentIndex(db: Database.Database): Map<string, number[]> {
  const rows = db
    .prepare(
      `SELECT s.account_id, s.date, s.to_addresses
       FROM emails s JOIN accounts a ON a.id = s.account_id
       WHERE lower(s.from_address) = lower(a.email)`,
    )
    .all() as { account_id: number; date: string; to_addresses: string }[];

  const index = new Map<string, number[]>();
  for (const row of rows) {
    const time = Date.parse(row.date);
    if (Number.isNaN(time)) continue;
    const recipients = new Set(
      parseRecipients(row.to_addresses).map((r) => r.trim().toLowerCase()),
    );
    for (const recipient of recipients) {
      const key = `${row.account_id}\n${recipient}`;
      const times = index.get(key);
      if (times) times.push(time);
      else index.set(key, [time]);
    }
  }
  for (const times of index.values()) times.sort((a, b) => a - b);
  return index;
}

/** Number of entries strictly before `time` in an ascending array. */
function countBefore(times: readonly number[] | undefined, time: number): number {
  if (!times) return 0;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type EmbeddingRow = {
  email_id: number;
  embedding: unknown;
  account_id: number;
  account_email: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  subject: string | null;
  date: string;
  in_reply_to: string | null;
  list_unsubscribe: string | null;
};

export function createSystem1TrainingRepo(getDb: () => Database.Database): System1TrainingRepo {
  return {
    async listSamples(questionId, opts) {
      const db = getDb();
      const labels = labelsFor(db, questionId);
      if (!labels || labels.size === 0) return [];

      // Gold first, then the newest mail, so a limit keeps the most valuable examples.
      let ids = [...labels.keys()].sort((a, b) => {
        const goldDiff = Number(labels.get(b)!.gold) - Number(labels.get(a)!.gold);
        return goldDiff !== 0 ? goldDiff : b - a;
      });
      if (opts.limit !== undefined && opts.limit > 0) ids = ids.slice(0, Math.floor(opts.limit));

      const rows: EmbeddingRow[] = [];
      for (let start = 0; start < ids.length; start += CHUNK) {
        const chunk = ids.slice(start, start + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        rows.push(
          ...(db
            .prepare(
              `SELECT ee.email_id, ee.embedding, e.account_id, a.email AS account_email,
                      e.from_address, e.from_name, e.to_addresses, e.subject, e.date,
                      e.in_reply_to, e.list_unsubscribe
               FROM email_embeddings ee
               JOIN emails e ON e.id = ee.email_id
               JOIN accounts a ON a.id = e.account_id
               WHERE ee.embedding_model = ? AND ee.email_id IN (${placeholders})`,
            )
            .all(opts.embeddingModel, ...chunk) as EmbeddingRow[]),
        );
      }
      if (rows.length === 0) return [];

      const sent = sentIndex(db);
      const samples: TrainingSample[] = [];
      for (const row of rows) {
        const embedding = decodeEmbedding(row.embedding);
        const label = labels.get(row.email_id);
        if (!embedding || !label) continue;

        const sentAt = Date.parse(row.date);
        const prior = countBefore(
          sent.get(`${row.account_id}\n${row.from_address.trim().toLowerCase()}`),
          Number.isNaN(sentAt) ? Number.POSITIVE_INFINITY : sentAt,
        );
        const features = buildFeatures(
          {
            from: { address: row.from_address, name: row.from_name },
            to: parseRecipients(row.to_addresses),
            subject: row.subject ?? '',
            inReplyTo: row.in_reply_to,
            listUnsubscribe: row.list_unsubscribe,
          },
          { myAddress: row.account_email, priorRepliesToSender: prior },
        );
        samples.push({
          emailId: row.email_id,
          input: { embedding, features },
          label: label.label,
          gold: label.gold,
        });
      }
      return samples.sort((a, b) => a.emailId - b.emailId);
    },
  };
}
