/**
 * Thread Repository Tests
 *
 * Tests for email threading functionality.
 * Task 5: Thread Repository for grouping emails by thread_id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createThreadRepo } from './thread-repo';
import { getDb, initDb, closeDb } from './connection';
import * as path from 'path';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

describe('threadRepo', () => {
  beforeEach(() => {
    initDb(':memory:', SCHEMA_PATH);
  });

  afterEach(() => {
    closeDb();
  });

  describe('getThreadedList', () => {
    it('groups emails by thread_id', async () => {
      const db = getDb();

      // Insert test account and folder
      db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
               VALUES ('Test', 'test@test.com', 'imap.test.com', 'smtp.test.com', 'test')`);
      db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);

      // Insert emails in same thread
      db.exec(`
        INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, to_addresses, date, thread_id, is_read)
        VALUES
          ('<msg1>', 1, 1, 1, 'Thread Subject', 'alice@test.com', '["bob@test.com"]', '2025-01-01T10:00:00Z', '<msg1>', 1),
          ('<msg2>', 1, 1, 2, 'Re: Thread Subject', 'bob@test.com', '["alice@test.com"]', '2025-01-01T11:00:00Z', '<msg1>', 0)
      `);

      const repo = createThreadRepo();
      const threads = await repo.getThreadedList(1, 1);

      expect(threads).toHaveLength(1);
      expect(threads[0].threadId).toBe('<msg1>');
      expect(threads[0].messageCount).toBe(2);
      expect(threads[0].unreadCount).toBe(1);
      expect(threads[0].isLatestUnread).toBe(true);
    });

    it('returns standalone emails as single-message threads', async () => {
      const db = getDb();

      db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
               VALUES ('Test', 'test@test.com', 'imap.test.com', 'smtp.test.com', 'test')`);
      db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);

      db.exec(`
        INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, to_addresses, date, thread_id, is_read)
        VALUES ('<standalone>', 1, 1, 1, 'Standalone', 'alice@test.com', '["bob@test.com"]', '2025-01-01T10:00:00Z', '<standalone>', 1)
      `);

      const repo = createThreadRepo();
      const threads = await repo.getThreadedList(1, 1);

      expect(threads).toHaveLength(1);
      expect(threads[0].messageCount).toBe(1);
    });

    it('sorts threads by latest date descending', async () => {
      const db = getDb();

      db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
               VALUES ('Test', 'test@test.com', 'imap.test.com', 'smtp.test.com', 'test')`);
      db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);

      // Insert two separate threads with different dates
      db.exec(`
        INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, to_addresses, date, thread_id, is_read)
        VALUES
          ('<old>', 1, 1, 1, 'Old Thread', 'alice@test.com', '["bob@test.com"]', '2025-01-01T10:00:00Z', '<old>', 1),
          ('<new>', 1, 1, 2, 'New Thread', 'bob@test.com', '["alice@test.com"]', '2025-01-02T10:00:00Z', '<new>', 0)
      `);

      const repo = createThreadRepo();
      const threads = await repo.getThreadedList(1, 1);

      expect(threads).toHaveLength(2);
      expect(threads[0].threadId).toBe('<new>'); // Most recent first
      expect(threads[1].threadId).toBe('<old>');
    });
  });

  describe('getThreadMessages', () => {
    it('returns all emails in thread sorted by date', async () => {
      const db = getDb();

      db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
               VALUES ('Test', 'test@test.com', 'imap.test.com', 'smtp.test.com', 'test')`);
      db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);

      db.exec(`
        INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, to_addresses, date, thread_id)
        VALUES
          ('<msg1>', 1, 1, 1, 'Original', 'alice@test.com', '["bob@test.com"]', '2025-01-01T10:00:00Z', '<msg1>'),
          ('<msg2>', 1, 1, 2, 'Re: Original', 'bob@test.com', '["alice@test.com"]', '2025-01-01T11:00:00Z', '<msg1>'),
          ('<msg3>', 1, 1, 3, 'Re: Re: Original', 'alice@test.com', '["bob@test.com"]', '2025-01-01T12:00:00Z', '<msg1>')
      `);

      const repo = createThreadRepo();
      const emails = await repo.getThreadMessages('<msg1>');

      expect(emails).toHaveLength(3);
      expect(emails[0].messageId).toBe('<msg1>');
      expect(emails[2].messageId).toBe('<msg3>');
    });

    it('returns empty array for non-existent thread', async () => {
      const db = getDb();

      db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
               VALUES ('Test', 'test@test.com', 'imap.test.com', 'smtp.test.com', 'test')`);
      db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);

      const repo = createThreadRepo();
      const emails = await repo.getThreadMessages('<nonexistent>');

      expect(emails).toHaveLength(0);
    });
  });
});
