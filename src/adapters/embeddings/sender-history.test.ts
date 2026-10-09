/**
 * "How often have I replied to this sender?" - a System 1 feature.
 *
 * Counts mail sent BY the account owner (From = the account address, any
 * folder) whose recipients include the sender's address.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { initDb, getDb, closeDb } from '../db/connection';
import { createPriorRepliesCounter } from './sender-history';

const SCHEMA_PATH = path.join(__dirname, '../db/schema.sql');

let uid = 0;
function insertMail(opts: {
  accountId?: number;
  from: string;
  to: unknown;
  folderId?: number;
  date?: string;
}): void {
  uid++;
  getDb()
    .prepare(
      `INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `<m${uid}@x>`,
      opts.accountId ?? 1,
      opts.folderId ?? 1,
      uid,
      opts.from,
      JSON.stringify(opts.to),
      opts.date ?? '2026-01-01T10:00:00.000Z',
    );
}

describe('createPriorRepliesCounter', () => {
  beforeEach(() => {
    uid = 0;
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('A', 'me@test.com', 'imap.test.com', 'smtp.test.com', 'me'),
                    ('B', 'other@test.com', 'imap.test.com', 'smtp.test.com', 'other')`);
    db.exec(
      `INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox'), (1, 'Sent', 'Sent'), (2, 'INBOX', 'Inbox')`,
    );
  });

  afterEach(() => {
    closeDb();
  });

  it('counts my mails addressed to the sender, in any folder', async () => {
    insertMail({ from: 'me@test.com', to: ['marie@atelier.be'], folderId: 2 });
    insertMail({ from: 'me@test.com', to: ['marie@atelier.be', 'x@y.com'], folderId: 2 });
    insertMail({ from: 'me@test.com', to: ['marie@atelier.be'], folderId: 1 });
    const count = createPriorRepliesCounter(getDb);
    expect(await count(1, 'marie@atelier.be')).toBe(3);
  });

  it('is case-insensitive on both addresses', async () => {
    insertMail({ from: 'ME@Test.com', to: ['Marie@Atelier.BE'], folderId: 2 });
    const count = createPriorRepliesCounter(getDb);
    expect(await count(1, 'marie@atelier.be')).toBe(1);
    expect(await count(1, 'MARIE@ATELIER.BE')).toBe(1);
  });

  it('understands recipients stored as {address} objects', async () => {
    insertMail({ from: 'me@test.com', to: [{ address: 'marie@atelier.be', name: 'Marie' }] });
    const count = createPriorRepliesCounter(getDb);
    expect(await count(1, 'marie@atelier.be')).toBe(1);
  });

  it('does not count mail from other people, other recipients, or other accounts', async () => {
    insertMail({ from: 'marie@atelier.be', to: ['me@test.com'] }); // received, not a reply
    insertMail({ from: 'me@test.com', to: ['paul@atelier.be'] }); // other recipient
    insertMail({ accountId: 2, folderId: 3, from: 'other@test.com', to: ['marie@atelier.be'] });
    const count = createPriorRepliesCounter(getDb);
    expect(await count(1, 'marie@atelier.be')).toBe(0);
  });

  it('does not match an address that merely contains the sender as a substring', async () => {
    insertMail({ from: 'me@test.com', to: ['notmarie@atelier.be', 'marie@atelier.be.evil.com'] });
    const count = createPriorRepliesCounter(getDb);
    expect(await count(1, 'marie@atelier.be')).toBe(0);
  });

  it('treats LIKE wildcards in an address literally', async () => {
    insertMail({ from: 'me@test.com', to: ['abc@x.com'] });
    const count = createPriorRepliesCounter(getDb);
    expect(await count(1, 'a_c@x.com')).toBe(0);
    expect(await count(1, '%@x.com')).toBe(0);
  });

  it('returns 0 for an unknown account', async () => {
    const count = createPriorRepliesCounter(getDb);
    expect(await count(99, 'marie@atelier.be')).toBe(0);
  });
});
