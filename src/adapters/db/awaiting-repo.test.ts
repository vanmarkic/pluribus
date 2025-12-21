/**
 * Awaiting Reply Repository Tests
 *
 * Tests for tracking emails that are awaiting a reply.
 * Task 8: Awaiting Repository
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAwaitingRepo } from './awaiting-repo';
import { getDb, initDb, closeDb } from './connection';
import * as path from 'path';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

describe('awaitingRepo', () => {
  beforeEach(() => {
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', 'test@test.com', 'imap.test.com', 'smtp.test.com', 'test')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);
  });

  afterEach(() => {
    closeDb();
  });

  describe('markAwaiting', () => {
    it('sets awaiting_reply to 1', async () => {
      const db = getDb();
      db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date)
               VALUES ('<msg1>', 1, 1, 1, 'test@test.com', '["other@test.com"]', '2025-01-01')`);

      const repo = createAwaitingRepo();
      await repo.markAwaiting(1);

      const row = db.prepare('SELECT awaiting_reply, awaiting_reply_since FROM emails WHERE id = 1').get() as any;
      expect(row.awaiting_reply).toBe(1);
      expect(row.awaiting_reply_since).toBeTruthy();
    });
  });

  describe('clearAwaiting', () => {
    it('sets awaiting_reply to 0', async () => {
      const db = getDb();
      db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date, awaiting_reply)
               VALUES ('<msg1>', 1, 1, 1, 'test@test.com', '["other@test.com"]', '2025-01-01', 1)`);

      const repo = createAwaitingRepo();
      await repo.clearAwaiting(1);

      const row = db.prepare('SELECT awaiting_reply FROM emails WHERE id = 1').get() as any;
      expect(row.awaiting_reply).toBe(0);
    });
  });

  describe('clearByReply', () => {
    it('clears awaiting when reply arrives', async () => {
      const db = getDb();
      db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date, awaiting_reply)
               VALUES ('<original>', 1, 1, 1, 'me@test.com', '["them@test.com"]', '2025-01-01', 1)`);

      const repo = createAwaitingRepo();
      const clearedId = await repo.clearByReply('<original>');

      expect(clearedId).toBe(1);
      const row = db.prepare('SELECT awaiting_reply FROM emails WHERE id = 1').get() as any;
      expect(row.awaiting_reply).toBe(0);
    });

    it('returns null if no matching awaiting email', async () => {
      const repo = createAwaitingRepo();
      const clearedId = await repo.clearByReply('<nonexistent>');
      expect(clearedId).toBeNull();
    });
  });

  describe('getAwaitingList', () => {
    it('returns emails with awaiting_reply = 1', async () => {
      const db = getDb();
      db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date, awaiting_reply)
               VALUES
                 ('<msg1>', 1, 1, 1, 'test@test.com', '["other@test.com"]', '2025-01-01', 1),
                 ('<msg2>', 1, 1, 2, 'test@test.com', '["other@test.com"]', '2025-01-02', 0)`);

      const repo = createAwaitingRepo();
      const emails = await repo.getAwaitingList(1);

      expect(emails).toHaveLength(1);
      expect(emails[0].messageId).toBe('<msg1>');
    });
  });
});
