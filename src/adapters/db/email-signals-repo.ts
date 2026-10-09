/**
 * Email Signals Repository
 *
 * Stores per-email classification signals (needs-reply probability,
 * importance, folder) with one row per producing source. Reads resolve the
 * "effective" signal with precedence user > system2 (LLM) > system1 (local).
 */

import Database from 'better-sqlite3';
import type { SignalRepo } from '../../core/ports';
import type { EmailSignal, ImportanceLevel, SignalSource, TriageFolder } from '../../core/domain';

/** SQL expression ranking sources: lower is stronger. */
const SOURCE_RANK_SQL = `CASE source WHEN 'user' THEN 0 WHEN 'system2' THEN 1 ELSE 2 END`;

/**
 * Parse a stored timestamp. We write ISO strings, but rows created through the
 * column default use SQLite's `YYYY-MM-DD HH:MM:SS` (UTC, no zone marker).
 */
function parseTimestamp(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

function toImportance(value: unknown): ImportanceLevel | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function mapSignal(row: any): EmailSignal {
  return {
    emailId: row.email_id,
    source: row.source as SignalSource,
    needsReply: row.needs_reply === null ? null : Number(row.needs_reply),
    importance: toImportance(row.importance),
    folder: (row.folder ?? null) as TriageFolder | null,
    confidence: row.confidence === null ? null : Number(row.confidence),
    modelVersion: row.model_version ?? null,
    updatedAt: parseTimestamp(row.updated_at),
  };
}

export function createSignalRepo(getDb: () => Database.Database): SignalRepo {
  return {
    async upsert(signal) {
      getDb()
        .prepare(
          `
        INSERT INTO email_signals (
          email_id, source, needs_reply, importance, folder, confidence, model_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email_id, source) DO UPDATE SET
          needs_reply = excluded.needs_reply,
          importance = excluded.importance,
          folder = excluded.folder,
          confidence = excluded.confidence,
          model_version = excluded.model_version,
          updated_at = excluded.updated_at
      `,
        )
        .run(
          signal.emailId,
          signal.source,
          signal.needsReply,
          signal.importance,
          signal.folder,
          signal.confidence,
          signal.modelVersion,
          new Date().toISOString(),
        );
    },

    async get(emailId, source) {
      const row = getDb()
        .prepare('SELECT * FROM email_signals WHERE email_id = ? AND source = ?')
        .get(emailId, source);
      return row ? mapSignal(row) : null;
    },

    async getEffective(emailId) {
      const row = getDb()
        .prepare(
          `SELECT * FROM email_signals WHERE email_id = ? ORDER BY ${SOURCE_RANK_SQL} LIMIT 1`,
        )
        .get(emailId);
      return row ? mapSignal(row) : null;
    },

    async listByEmail(emailId) {
      const rows = getDb()
        .prepare(`SELECT * FROM email_signals WHERE email_id = ? ORDER BY ${SOURCE_RANK_SQL}`)
        .all(emailId) as any[];
      return rows.map(mapSignal);
    },

    async listBySource(source, opts = {}) {
      const base = 'SELECT * FROM email_signals WHERE source = ? ORDER BY updated_at DESC, id DESC';
      const db = getDb();
      const rows = (
        opts.limit !== undefined
          ? db.prepare(`${base} LIMIT ?`).all(source, Math.max(1, Math.floor(opts.limit)))
          : db.prepare(base).all(source)
      ) as any[];
      return rows.map(mapSignal);
    },
  };
}
