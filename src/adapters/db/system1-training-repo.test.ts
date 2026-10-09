/**
 * System 1 Training Repository Tests
 *
 * Labels come only from real sources: user actions (gold) and System 2
 * signals (teacher). `email_embeddings.folder` holds LLM pseudo-labels and
 * 'INBOX' placeholders and must never be read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { createSystem1TrainingRepo } from './system1-training-repo';
import { createSignalRepo } from './email-signals-repo';
import { getDb, initDb, closeDb } from './connection';
import { FEATURE_NAMES } from '../../core/system1/features';
import type { TrainingSample } from '../../core/system1/types';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MODEL = 'Xenova/multilingual-e5-small';
const OTHER_MODEL = 'Xenova/all-MiniLM-L6-v2';
const ME = 'Me@Test.com';

let uid = 0;

type NewEmail = {
  from?: string;
  to?: string[];
  subject?: string;
  date?: string;
  inReplyTo?: string | null;
  listUnsubscribe?: string | null;
  accountId?: number;
};

function addEmail(e: NewEmail = {}): number {
  uid += 1;
  const result = getDb()
    .prepare(
      `INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, from_name,
                           to_addresses, date, in_reply_to, list_unsubscribe)
       VALUES (?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      `<m${uid}@test>`,
      e.accountId ?? 1,
      uid,
      e.subject ?? 'Bonjour',
      e.from ?? 'alice@example.com',
      JSON.stringify(e.to ?? ['me@test.com']),
      e.date ?? '2026-06-10T10:00:00.000Z',
      e.inReplyTo ?? null,
      e.listUnsubscribe ?? null,
    );
  return Number(result.lastInsertRowid);
}

function addEmbedding(
  emailId: number,
  vector: number[],
  opts: { model?: string; folder?: string } = {},
): void {
  const buf = Buffer.from(Float32Array.from(vector).buffer);
  getDb()
    .prepare(
      `INSERT INTO email_embeddings (email_id, embedding, embedding_model, folder) VALUES (?, ?, ?, ?)`,
    )
    .run(emailId, buf, opts.model ?? MODEL, opts.folder ?? 'INBOX');
}

/** A new email with an embedding (default vector derived from its id). */
function embedded(e: NewEmail = {}, opts: { model?: string; folder?: string } = {}): number {
  const id = addEmail(e);
  addEmbedding(id, [id, id + 0.5, -id, 0.25], opts);
  return id;
}

function trainingExample(emailId: number | null, choice: string, createdAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO training_examples (account_id, email_id, from_address, from_domain, subject, user_choice, created_at)
       VALUES (1, ?, 'a@x.com', 'x.com', 's', ?, ?)`,
    )
    .run(emailId, choice, createdAt);
}

function feedback(
  emailId: number,
  action: string,
  finalFolder: string | null,
  createdAt: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO classification_feedback (email_id, action, final_folder, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(emailId, action, finalFolder, createdAt);
}

function triageLog(emailId: number, source: string, finalFolder: string, createdAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO triage_log (email_id, account_id, final_folder, source, created_at) VALUES (?, 1, ?, ?, ?)`,
    )
    .run(emailId, finalFolder, source, createdAt);
}

describe('system1TrainingRepo', () => {
  const signals = createSignalRepo(getDb);
  const repo = createSystem1TrainingRepo(getDb);

  const list = (questionId: string, model = MODEL, limit?: number) =>
    repo.listSamples(questionId, {
      embeddingModel: model,
      ...(limit !== undefined ? { limit } : {}),
    });
  const byId = (samples: TrainingSample[]) => new Map(samples.map((s) => [s.emailId, s]));

  beforeEach(() => {
    uid = 0;
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', '${ME}', 'imap.test.com', 'smtp.test.com', 'me'),
                    ('Other', 'other@test.com', 'imap.test.com', 'smtp.test.com', 'other')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES (2, 'INBOX', 'Inbox')`);
  });

  afterEach(() => {
    closeDb();
  });

  describe('folder', () => {
    it('returns nothing for mail without a real label (never uses email_embeddings.folder)', async () => {
      embedded({}, { folder: 'Planning' });
      embedded({}, { folder: 'INBOX' });
      expect(await list('folder')).toEqual([]);
    });

    it('takes gold from training_examples, feedback and user-override triage_log rows', async () => {
      const a = embedded();
      const b = embedded();
      const c = embedded();
      trainingExample(a, 'Planning', '2026-06-01 10:00:00');
      feedback(b, 'accept_edit', 'Feed', '2026-06-01 10:00:00');
      triageLog(c, 'user-override', 'Social', '2026-06-01 10:00:00');

      const samples = byId(await list('folder'));
      expect(samples.get(a)).toMatchObject({ label: 'Planning', gold: true });
      expect(samples.get(b)).toMatchObject({ label: 'Feed', gold: true });
      expect(samples.get(c)).toMatchObject({ label: 'Social', gold: true });
    });

    it('takes the teacher label from the system2 signal', async () => {
      const a = embedded();
      await signals.upsert({
        emailId: a,
        source: 'system2',
        needsReply: null,
        importance: null,
        folder: 'Promotions',
        confidence: 0.9,
        modelVersion: 'm',
      });
      const sample = byId(await list('folder')).get(a);
      expect(sample).toMatchObject({ label: 'Promotions', gold: false });
    });

    it('lets gold win over the teacher', async () => {
      const a = embedded({}, { folder: 'Archive' });
      await signals.upsert({
        emailId: a,
        source: 'system2',
        needsReply: null,
        importance: null,
        folder: 'Promotions',
        confidence: 0.9,
        modelVersion: 'm',
      });
      feedback(a, 'accept_edit', 'Planning', '2026-06-02 10:00:00');
      const sample = byId(await list('folder')).get(a);
      expect(sample).toMatchObject({ label: 'Planning', gold: true });
    });

    it('uses the most recent gold action when the user changed their mind', async () => {
      const a = embedded();
      trainingExample(a, 'Planning', '2026-06-01 10:00:00');
      triageLog(a, 'user-override', 'Social', '2026-06-03T09:00:00.000Z');
      feedback(a, 'accept', 'Feed', '2026-06-02 08:00:00');
      expect(byId(await list('folder')).get(a)?.label).toBe('Social');

      // A later correction elsewhere wins again, whichever table it is in.
      trainingExample(a, 'Archive', '2026-06-04 12:00:00');
      expect(byId(await list('folder')).get(a)?.label).toBe('Archive');
    });

    it('ignores dismissals, orphaned examples, non-gold log sources and unknown folders', async () => {
      const a = embedded();
      const b = embedded();
      const c = embedded();
      const d = embedded();
      feedback(a, 'dismiss', null, '2026-06-01 10:00:00');
      trainingExample(null, 'Feed', '2026-06-01 10:00:00');
      triageLog(b, 'llm', 'Feed', '2026-06-01 10:00:00');
      triageLog(b, 'pattern-fallback', 'Feed', '2026-06-01 10:00:00');
      triageLog(b, 'sender_rule', 'Feed', '2026-06-01 10:00:00');
      feedback(c, 'accept', 'Some/Unknown/Folder', '2026-06-01 10:00:00');
      await signals.upsert({
        emailId: d,
        source: 'system1',
        needsReply: null,
        importance: null,
        folder: 'Feed',
        confidence: 0.9,
        modelVersion: 'm',
      });
      expect(await list('folder')).toEqual([]);
    });
  });

  describe('needsReply', () => {
    it('uses user signals as gold and system2 signals as teacher, thresholded at 0.5', async () => {
      const gold = embedded();
      const yes = embedded();
      const no = embedded();
      const edge = embedded();
      await signals.upsert({
        emailId: gold,
        source: 'user',
        needsReply: 0,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: null,
      });
      await signals.upsert({
        emailId: gold,
        source: 'system2',
        needsReply: 1,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });
      await signals.upsert({
        emailId: yes,
        source: 'system2',
        needsReply: 0.8,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });
      await signals.upsert({
        emailId: no,
        source: 'system2',
        needsReply: 0.2,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });
      await signals.upsert({
        emailId: edge,
        source: 'system2',
        needsReply: 0.5,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });

      const samples = byId(await list('needsReply'));
      expect(samples.get(gold)).toMatchObject({ label: 'false', gold: true });
      expect(samples.get(yes)).toMatchObject({ label: 'true', gold: false });
      expect(samples.get(no)).toMatchObject({ label: 'false', gold: false });
      expect(samples.get(edge)).toMatchObject({ label: 'true', gold: false });
    });

    it("never learns from System 1's own answers or from signals without a value", async () => {
      const a = embedded();
      const b = embedded();
      await signals.upsert({
        emailId: a,
        source: 'system1',
        needsReply: 0.99,
        importance: 4,
        folder: 'Feed',
        confidence: 0.9,
        modelVersion: 's1',
      });
      await signals.upsert({
        emailId: b,
        source: 'system2',
        needsReply: null,
        importance: 3,
        folder: null,
        confidence: 0.9,
        modelVersion: 'm',
      });
      expect(await list('needsReply')).toEqual([]);
    });
  });

  describe('importance', () => {
    it('uses a non-null user importance as gold and system2 importance as teacher', async () => {
      const gold = embedded();
      const teacher = embedded();
      const doneButUnrated = embedded();
      await signals.upsert({
        emailId: gold,
        source: 'user',
        needsReply: 0,
        importance: 1,
        folder: null,
        confidence: 1,
        modelVersion: null,
      });
      await signals.upsert({
        emailId: gold,
        source: 'system2',
        needsReply: 1,
        importance: 4,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });
      await signals.upsert({
        emailId: teacher,
        source: 'system2',
        needsReply: 1,
        importance: 3,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });
      // "Done" writes a user signal with importance null: teacher label stays.
      await signals.upsert({
        emailId: doneButUnrated,
        source: 'user',
        needsReply: 1,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: null,
      });
      await signals.upsert({
        emailId: doneButUnrated,
        source: 'system2',
        needsReply: 1,
        importance: 2,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });

      const samples = byId(await list('importance'));
      expect(samples.get(gold)).toMatchObject({ label: '1', gold: true });
      expect(samples.get(teacher)).toMatchObject({ label: '3', gold: false });
      expect(samples.get(doneButUnrated)).toMatchObject({ label: '2', gold: false });
    });

    it('ignores System 1 importance', async () => {
      const a = embedded();
      await signals.upsert({
        emailId: a,
        source: 'system1',
        needsReply: 1,
        importance: 4,
        folder: null,
        confidence: 0.9,
        modelVersion: 's1',
      });
      expect(await list('importance')).toEqual([]);
    });
  });

  describe('embeddings', () => {
    it('filters by embedding model and decodes Float32 vectors exactly', async () => {
      const a = addEmail();
      addEmbedding(a, [0.1, -0.2, 0.3, 0.4], { model: MODEL });
      addEmbedding(a, [9, 9, 9, 9, 9], { model: OTHER_MODEL });
      const b = addEmail();
      addEmbedding(b, [1, 2, 3], { model: OTHER_MODEL });
      for (const id of [a, b]) {
        await signals.upsert({
          emailId: id,
          source: 'system2',
          needsReply: 1,
          importance: null,
          folder: null,
          confidence: 1,
          modelVersion: 'm',
        });
      }

      const mine = await list('needsReply', MODEL);
      expect(mine.map((s) => s.emailId)).toEqual([a]);
      expect(mine[0]!.input.embedding).toBeInstanceOf(Float32Array);
      expect(Array.from(mine[0]!.input.embedding)).toEqual(
        Array.from(Float32Array.from([0.1, -0.2, 0.3, 0.4])),
      );

      const other = await list('needsReply', OTHER_MODEL);
      expect(other.map((s) => s.emailId).sort()).toEqual([a, b].sort());
      expect(await list('needsReply', 'unknown-model')).toEqual([]);
    });

    it('skips labelled mail that has no embedding yet', async () => {
      const withVector = embedded();
      const without = addEmail();
      for (const id of [withVector, without]) {
        await signals.upsert({
          emailId: id,
          source: 'system2',
          needsReply: 1,
          importance: null,
          folder: null,
          confidence: 1,
          modelVersion: 'm',
        });
      }
      expect((await list('needsReply')).map((s) => s.emailId)).toEqual([withVector]);
    });

    it('returns an empty list for an unknown question', async () => {
      embedded();
      expect(await list('nonsense')).toEqual([]);
    });

    it('caps the result at `limit`, keeping gold first and then the newest mail', async () => {
      const ids = [embedded(), embedded(), embedded(), embedded()];
      for (const id of ids) {
        await signals.upsert({
          emailId: id,
          source: 'system2',
          needsReply: 1,
          importance: null,
          folder: null,
          confidence: 1,
          modelVersion: 'm',
        });
      }
      await signals.upsert({
        emailId: ids[0]!,
        source: 'user',
        needsReply: 0,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: null,
      });

      const limited = await list('needsReply', MODEL, 2);
      expect(limited.map((s) => s.emailId).sort((x, y) => x - y)).toEqual([ids[0]!, ids[3]!]);
    });
  });

  describe('features', () => {
    it('builds the same feature vector the decorator will use at inference time', async () => {
      const a = embedded({
        from: 'News@Shop.example',
        to: ['me@TEST.com', 'x@y.z'],
        subject: 'Pourriez-vous confirmer ?',
        inReplyTo: '<prev@x>',
        listUnsubscribe: '<mailto:u@shop.example>',
      });
      await signals.upsert({
        emailId: a,
        source: 'system2',
        needsReply: 1,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });

      const [sample] = await list('needsReply');
      expect(sample!.input.features).toHaveLength(FEATURE_NAMES.length);
      const f = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, sample!.input.features[i]!]));
      expect(f['hasListUnsubscribe']).toBe(1);
      expect(f['toIncludesMe']).toBe(1);
      expect(f['isReply']).toBe(1);
      expect(f['subjectHasQuestion']).toBe(1);
      expect(f['priorReplies']).toBe(0);
      expect(sample!.input.features.slice(5).filter((v) => v === 1)).toHaveLength(1);
    });

    it('counts only my earlier mail to that sender as prior replies', async () => {
      // Sent by me (any folder) to alice, at various dates.
      addEmail({
        from: ME.toLowerCase(),
        to: ['alice@example.com'],
        date: '2026-05-01T10:00:00.000Z',
      });
      addEmail({
        from: 'ME@test.com',
        to: ['Alice@Example.com', 'bob@example.com'],
        date: '2026-05-20T10:00:00.000Z',
      });
      addEmail({ from: ME, to: ['bob@example.com'], date: '2026-05-21T10:00:00.000Z' });
      // Reply to THIS email, sent afterwards: must not leak into its own feature.
      addEmail({ from: ME, to: ['alice@example.com'], date: '2026-06-11T10:00:00.000Z' });
      // Someone else's mail to alice does not count either.
      addEmail({
        from: 'eve@example.com',
        to: ['alice@example.com'],
        date: '2026-05-05T10:00:00.000Z',
      });

      const incoming = embedded({ from: 'alice@example.com', date: '2026-06-10T10:00:00.000Z' });
      await signals.upsert({
        emailId: incoming,
        source: 'system2',
        needsReply: 1,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });

      const [sample] = await list('needsReply');
      const idx = FEATURE_NAMES.indexOf('priorReplies');
      expect(sample!.input.features[idx]).toBeCloseTo(Math.log1p(2) / 3, 12);
    });

    it('does not mix up accounts when counting prior replies or reading my address', async () => {
      // Account 2 (other@test.com) wrote to alice; account 1 did not.
      addEmail({
        accountId: 2,
        from: 'other@test.com',
        to: ['alice@example.com'],
        date: '2026-05-01T10:00:00.000Z',
      });
      const incoming = embedded({
        from: 'alice@example.com',
        to: ['other@test.com'],
        accountId: 1,
      });
      await signals.upsert({
        emailId: incoming,
        source: 'system2',
        needsReply: 1,
        importance: null,
        folder: null,
        confidence: 1,
        modelVersion: 'm',
      });

      const [sample] = await list('needsReply');
      const f = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, sample!.input.features[i]!]));
      expect(f['priorReplies']).toBe(0);
      expect(f['toIncludesMe']).toBe(0); // addressed to account 2's address, not account 1's
    });
  });
});
