/**
 * Email Signals Repository Tests
 *
 * One signal row per (email, source); reads resolve the effective signal with
 * precedence user > system2 > system1.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { createSignalRepo } from './email-signals-repo';
import { getDb, initDb, closeDb } from './connection';
import type { EmailSignal } from '../../core/domain';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

type NewSignal = Omit<EmailSignal, 'updatedAt'>;

function signal(overrides: Partial<NewSignal> = {}): NewSignal {
  return {
    emailId: 1,
    source: 'system2',
    needsReply: 1,
    importance: 3,
    folder: 'INBOX',
    confidence: 0.9,
    modelVersion: 'mistral:7b',
    ...overrides,
  };
}

describe('signalRepo', () => {
  const repo = createSignalRepo(getDb);

  beforeEach(() => {
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', 'me@test.com', 'imap.test.com', 'smtp.test.com', 'me')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);
    db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date)
             VALUES ('<m1>', 1, 1, 1, 'a@x.com', '["me@test.com"]', '2026-01-01T10:00:00.000Z'),
                    ('<m2>', 1, 1, 2, 'b@x.com', '["me@test.com"]', '2026-01-02T10:00:00.000Z')`);
  });

  afterEach(() => {
    closeDb();
  });

  describe('upsert / get', () => {
    it('round-trips every field', async () => {
      await repo.upsert(
        signal({
          source: 'system1',
          needsReply: 0.83,
          importance: 4,
          folder: 'Planning',
          confidence: 0.71,
          modelVersion: 'system1:needsReply@v3',
        }),
      );

      const got = await repo.get(1, 'system1');
      expect(got).toMatchObject({
        emailId: 1,
        source: 'system1',
        needsReply: 0.83,
        importance: 4,
        folder: 'Planning',
        confidence: 0.71,
        modelVersion: 'system1:needsReply@v3',
      });
      expect(got?.updatedAt).toBeInstanceOf(Date);
      expect(Math.abs(Date.now() - (got?.updatedAt.getTime() ?? 0))).toBeLessThan(60_000);
    });

    it('stores nulls for unknown fields', async () => {
      await repo.upsert(
        signal({
          source: 'user',
          needsReply: null,
          importance: null,
          folder: null,
          confidence: null,
          modelVersion: null,
        }),
      );
      const got = await repo.get(1, 'user');
      expect(got).toMatchObject({
        needsReply: null,
        importance: null,
        folder: null,
        confidence: null,
        modelVersion: null,
      });
    });

    it('returns null when there is no signal for that source', async () => {
      await repo.upsert(signal({ source: 'system2' }));
      expect(await repo.get(1, 'user')).toBeNull();
      expect(await repo.get(2, 'system2')).toBeNull();
    });

    it('replaces the existing row for the same (email, source)', async () => {
      await repo.upsert(signal({ needsReply: 0, importance: 1, modelVersion: 'old' }));
      await repo.upsert(signal({ needsReply: 1, importance: 4, modelVersion: 'new' }));

      const rows = getDb().prepare('SELECT COUNT(*) AS n FROM email_signals').get() as {
        n: number;
      };
      expect(rows.n).toBe(1);
      expect(await repo.get(1, 'system2')).toMatchObject({
        needsReply: 1,
        importance: 4,
        modelVersion: 'new',
      });
    });

    it('keeps signals from different sources and emails independent', async () => {
      await repo.upsert(signal({ emailId: 1, source: 'system1', needsReply: 0.2 }));
      await repo.upsert(signal({ emailId: 1, source: 'system2', needsReply: 1 }));
      await repo.upsert(signal({ emailId: 2, source: 'system2', needsReply: 0 }));

      expect((await repo.get(1, 'system1'))?.needsReply).toBe(0.2);
      expect((await repo.get(1, 'system2'))?.needsReply).toBe(1);
      expect((await repo.get(2, 'system2'))?.needsReply).toBe(0);
    });

    it('refreshes updatedAt when a signal is replaced', async () => {
      await repo.upsert(signal());
      getDb().prepare(`UPDATE email_signals SET updated_at = '2020-01-01T00:00:00.000Z'`).run();
      expect((await repo.get(1, 'system2'))?.updatedAt.toISOString()).toBe(
        '2020-01-01T00:00:00.000Z',
      );

      await repo.upsert(signal());
      const after = await repo.get(1, 'system2');
      expect(after!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('reads rows written with the SQLite default timestamp as UTC', async () => {
      getDb().prepare(`INSERT INTO email_signals (email_id, source) VALUES (1, 'user')`).run();
      // datetime('now') is UTC without a zone marker; a naive parse would be
      // off by the local offset, so run this under a non-UTC zone.
      const previousTz = process.env.TZ;
      process.env.TZ = 'America/Los_Angeles';
      try {
        const got = await repo.get(1, 'user');
        expect(Math.abs(Date.now() - got!.updatedAt.getTime())).toBeLessThan(60_000);
      } finally {
        if (previousTz === undefined) delete process.env.TZ;
        else process.env.TZ = previousTz;
      }
    });

    it('rejects an unknown source', async () => {
      await expect(repo.upsert(signal({ source: 'oracle' as never }))).rejects.toThrow();
    });

    it('rejects an importance outside 1..4', async () => {
      await expect(repo.upsert(signal({ importance: 5 as never }))).rejects.toThrow();
      await expect(repo.upsert(signal({ importance: 0 as never }))).rejects.toThrow();
    });

    it('rejects a signal for a missing email (foreign key)', async () => {
      await expect(repo.upsert(signal({ emailId: 999 }))).rejects.toThrow();
    });

    it('is removed when the email is deleted', async () => {
      await repo.upsert(signal());
      getDb().prepare('DELETE FROM emails WHERE id = 1').run();
      expect(await repo.get(1, 'system2')).toBeNull();
    });
  });

  describe('getEffective', () => {
    it('is null when there are no signals', async () => {
      expect(await repo.getEffective(1)).toBeNull();
    });

    it('returns the only signal there is', async () => {
      await repo.upsert(signal({ source: 'system1', needsReply: 0.4 }));
      expect((await repo.getEffective(1))?.source).toBe('system1');
    });

    it('prefers system2 over system1', async () => {
      await repo.upsert(signal({ source: 'system1', needsReply: 0.4 }));
      await repo.upsert(signal({ source: 'system2', needsReply: 1 }));
      const eff = await repo.getEffective(1);
      expect(eff?.source).toBe('system2');
      expect(eff?.needsReply).toBe(1);
    });

    it('prefers user over system2 and system1 regardless of insertion order', async () => {
      await repo.upsert(signal({ source: 'user', needsReply: 0, importance: 1 }));
      await repo.upsert(signal({ source: 'system2', needsReply: 1, importance: 4 }));
      await repo.upsert(signal({ source: 'system1', needsReply: 0.9, importance: 3 }));
      const eff = await repo.getEffective(1);
      expect(eff).toMatchObject({ source: 'user', needsReply: 0, importance: 1 });
    });

    it('resolves per email', async () => {
      await repo.upsert(signal({ emailId: 1, source: 'user' }));
      await repo.upsert(signal({ emailId: 2, source: 'system1' }));
      expect((await repo.getEffective(1))?.source).toBe('user');
      expect((await repo.getEffective(2))?.source).toBe('system1');
    });

    it('is row-level: a user row with null fields still wins', async () => {
      await repo.upsert(signal({ source: 'user', needsReply: 1, importance: null }));
      await repo.upsert(signal({ source: 'system2', needsReply: 1, importance: 4 }));
      const eff = await repo.getEffective(1);
      expect(eff?.source).toBe('user');
      expect(eff?.importance).toBeNull();
    });
  });

  describe('listByEmail', () => {
    it('lists all sources strongest first', async () => {
      await repo.upsert(signal({ source: 'system1' }));
      await repo.upsert(signal({ source: 'user' }));
      await repo.upsert(signal({ source: 'system2' }));
      await repo.upsert(signal({ emailId: 2, source: 'system2' }));

      const list = await repo.listByEmail(1);
      expect(list.map((s) => s.source)).toEqual(['user', 'system2', 'system1']);
    });

    it('is empty for an email without signals', async () => {
      expect(await repo.listByEmail(1)).toEqual([]);
    });
  });

  describe('listBySource', () => {
    beforeEach(async () => {
      await repo.upsert(signal({ emailId: 1, source: 'system2' }));
      await repo.upsert(signal({ emailId: 2, source: 'system2' }));
      await repo.upsert(signal({ emailId: 1, source: 'user' }));
      getDb()
        .prepare(
          `UPDATE email_signals SET updated_at = ? WHERE email_id = 1 AND source = 'system2'`,
        )
        .run('2026-03-01T00:00:00.000Z');
      getDb()
        .prepare(
          `UPDATE email_signals SET updated_at = ? WHERE email_id = 2 AND source = 'system2'`,
        )
        .run('2026-03-02T00:00:00.000Z');
    });

    it('returns only that source, newest first', async () => {
      const list = await repo.listBySource('system2');
      expect(list.map((s) => s.emailId)).toEqual([2, 1]);
      expect(list.every((s) => s.source === 'system2')).toBe(true);
    });

    it('honours the limit', async () => {
      const list = await repo.listBySource('system2', { limit: 1 });
      expect(list.map((s) => s.emailId)).toEqual([2]);
    });

    it('is empty for a source with no rows', async () => {
      expect(await repo.listBySource('system1')).toEqual([]);
    });
  });
});
