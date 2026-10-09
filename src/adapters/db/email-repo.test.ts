/**
 * Email repository: body snippet handling.
 *
 * `saveBody` derives the list-view snippet from the body text. Under body
 * encryption the text it receives is ciphertext, so the snippet must be empty
 * instead of an unreadable (or, worse, plaintext-derived) string.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { createEmailRepo } from './email-repo';
import { wrapEmailRepoWithEncryption } from './email-repo-encryption';
import { deriveContentKey } from '../keychain/body-cipher';
import { getDb, initDb, closeDb } from './connection';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const KEY = deriveContentKey('test-passphrase');

function snippetOf(emailId: number): string | null {
  const row = getDb().prepare('SELECT snippet FROM emails WHERE id = ?').get(emailId) as
    | { snippet: string | null }
    | undefined;
  return row ? row.snippet : null;
}

describe('emailRepo.saveBody snippet', () => {
  beforeEach(() => {
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', 'me@test.com', 'imap.test.com', 'smtp.test.com', 'me')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);
    db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date, snippet)
             VALUES ('<m1>', 1, 1, 1, 'a@x.com', '["me@test.com"]', '2026-01-01T10:00:00.000Z', '')`);
  });

  afterEach(() => {
    closeDb();
  });

  it('stores a plaintext snippet (first 200 chars, whitespace collapsed) when unencrypted', async () => {
    const repo = createEmailRepo();
    const text = `Hello   Bob,\n\n${'word '.repeat(100)}`;
    await repo.saveBody(1, { text, html: '' });

    const snippet = snippetOf(1)!;
    expect(snippet.startsWith('Hello Bob, word word')).toBe(true);
    expect(snippet).not.toMatch(/\s{2,}/);
    expect(snippet.length).toBeLessThanOrEqual(200);
    expect(snippet.length).toBeGreaterThan(150);
  });

  it('marks the body as fetched and stores the body', async () => {
    const repo = createEmailRepo();
    await repo.saveBody(1, { text: 'short body', html: '<p>short body</p>' });
    expect(snippetOf(1)).toBe('short body');
    const row = getDb().prepare('SELECT body_fetched FROM emails WHERE id = 1').get() as {
      body_fetched: number;
    };
    expect(row.body_fetched).toBe(1);
    expect(await repo.getBody(1)).toEqual({ text: 'short body', html: '<p>short body</p>' });
  });

  it('stores an empty snippet for an empty text body', async () => {
    const repo = createEmailRepo();
    await repo.saveBody(1, { text: '', html: '<p>only html</p>' });
    expect(snippetOf(1)).toBe('');
  });

  it('stores an empty snippet under body encryption (no ciphertext, no plaintext)', async () => {
    const secret = 'Confidential: the merger closes Friday';
    const repo = wrapEmailRepoWithEncryption(createEmailRepo(), KEY);
    await repo.saveBody(1, { text: secret, html: `<p>${secret}</p>` });

    const snippet = snippetOf(1);
    expect(snippet).toBe('');
    // The body itself is still readable through the wrapper.
    expect(await repo.getBody(1)).toEqual({ text: secret, html: `<p>${secret}</p>` });
    // And nothing in the emails row leaks it.
    const row = JSON.stringify(getDb().prepare('SELECT * FROM emails WHERE id = 1').get());
    expect(row).not.toContain('merger');
    expect(row).not.toContain('v1:');
  });

  it('keeps clearing a previous plaintext snippet when the body is re-saved encrypted', async () => {
    const raw = createEmailRepo();
    await raw.saveBody(1, { text: 'old plaintext snippet', html: '' });
    expect(snippetOf(1)).toBe('old plaintext snippet');

    await wrapEmailRepoWithEncryption(raw, KEY).saveBody(1, {
      text: 'old plaintext snippet',
      html: '',
    });
    expect(snippetOf(1)).toBe('');
  });
});
