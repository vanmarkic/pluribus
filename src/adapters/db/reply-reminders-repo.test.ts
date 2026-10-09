/**
 * Reply Reminders Repository Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { createReplyReminderRepo } from './reply-reminders-repo';
import { getDb, initDb, closeDb } from './connection';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

describe('replyReminderRepo', () => {
  const repo = createReplyReminderRepo(getDb);

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

  it('returns null when nothing was recorded', async () => {
    expect(await repo.get(1)).toBeNull();
  });

  it.each(['done', 'dismissed'] as const)(
    'stores a %s reminder without a wake-up time',
    async (state) => {
      await repo.set(1, state);
      const got = await repo.get(1);
      expect(got).toMatchObject({ emailId: 1, state, snoozedUntil: null });
      expect(Math.abs(Date.now() - got!.updatedAt.getTime())).toBeLessThan(60_000);
    },
  );

  it('stores a snoozed reminder with its wake-up time', async () => {
    const until = new Date('2026-06-01T08:30:00.000Z');
    await repo.set(1, 'snoozed', until);
    const got = await repo.get(1);
    expect(got?.state).toBe('snoozed');
    expect(got?.snoozedUntil?.toISOString()).toBe(until.toISOString());
  });

  it('requires a wake-up time for snoozed reminders', async () => {
    await expect(repo.set(1, 'snoozed')).rejects.toThrow(/snoozedUntil/);
    await expect(repo.set(1, 'snoozed', null)).rejects.toThrow(/snoozedUntil/);
    expect(await repo.get(1)).toBeNull();
  });

  it('ignores a wake-up time for non-snoozed states', async () => {
    await repo.set(1, 'done', new Date('2026-06-01T08:30:00.000Z'));
    expect((await repo.get(1))?.snoozedUntil).toBeNull();
  });

  it('replaces the previous state (one row per email)', async () => {
    await repo.set(1, 'snoozed', new Date('2026-06-01T08:30:00.000Z'));
    await repo.set(1, 'done');

    const count = getDb().prepare('SELECT COUNT(*) AS n FROM reply_reminders').get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    expect(await repo.get(1)).toMatchObject({ state: 'done', snoozedUntil: null });
  });

  it('keeps emails independent', async () => {
    await repo.set(1, 'done');
    await repo.set(2, 'dismissed');
    expect((await repo.get(1))?.state).toBe('done');
    expect((await repo.get(2))?.state).toBe('dismissed');
  });

  it('clear removes the reminder and tolerates a missing one', async () => {
    await repo.set(1, 'done');
    await repo.clear(1);
    expect(await repo.get(1)).toBeNull();
    await expect(repo.clear(1)).resolves.toBeUndefined();
  });

  it('is removed when the email is deleted', async () => {
    await repo.set(1, 'done');
    getDb().prepare('DELETE FROM emails WHERE id = 1').run();
    expect(await repo.get(1)).toBeNull();
  });

  it('rejects a reminder for a missing email (foreign key)', async () => {
    await expect(repo.set(999, 'done')).rejects.toThrow();
  });
});
