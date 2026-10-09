/**
 * Embedding repository: upsert modes and model keys.
 *
 * The System 1 decorator stores the vector it scored an email with; the RAG
 * indexer must be able to attach a folder label to that row without replacing
 * the vector (keepVector), and the decorator must be able to refresh a vector
 * without erasing the label (keepFolder).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { initDb, getDb, closeDb } from '../db/connection';
import { createEmbeddingRepo } from './embedding-repo';

const SCHEMA_PATH = path.join(__dirname, '../db/schema.sql');

const MODEL = 'Xenova/multilingual-e5-small';

describe('embeddingRepo.save', () => {
  beforeEach(() => {
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', 'me@test.com', 'imap.test.com', 'smtp.test.com', 'me')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);
    for (const id of [1, 2]) {
      db.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date)
               VALUES ('<m${id}>', 1, 1, ${id}, 'a@x.com', '["me@test.com"]', '2026-01-01T10:00:00.000Z')`);
    }
  });

  afterEach(() => {
    closeDb();
  });

  it('replaces vector and label by default', async () => {
    const repo = createEmbeddingRepo(getDb());
    await repo.save(1, [1, 0, 0], 'Feed', false, MODEL);
    await repo.save(1, [0, 1, 0], 'Planning', true, MODEL);

    const row = await repo.findByEmail(1, MODEL);
    expect(row?.embedding).toEqual([0, 1, 0]);
    expect(row?.folder).toBe('Planning');
    expect(row?.isCorrection).toBe(true);
    expect(await repo.count(MODEL)).toBe(1);
  });

  it('keepVector updates the label but never the stored vector', async () => {
    const repo = createEmbeddingRepo(getDb());
    await repo.save(1, [1, 0, 0], '', false, MODEL);
    await repo.save(1, [0, 0, 1], 'Feed', true, MODEL, { keepVector: true });

    const row = await repo.findByEmail(1, MODEL);
    expect(row?.embedding).toEqual([1, 0, 0]);
    expect(row?.folder).toBe('Feed');
    expect(row?.isCorrection).toBe(true);
  });

  it('keepVector inserts normally when there is no row yet', async () => {
    const repo = createEmbeddingRepo(getDb());
    await repo.save(2, [0.5, 0.5, 0], 'Social', false, MODEL, { keepVector: true });
    const row = await repo.findByEmail(2, MODEL);
    expect(row?.embedding).toEqual([0.5, 0.5, 0]);
    expect(row?.folder).toBe('Social');
  });

  it('keepFolder refreshes the vector and keeps the label', async () => {
    const repo = createEmbeddingRepo(getDb());
    await repo.save(1, [1, 0, 0], 'Promotions', true, MODEL);
    await repo.save(1, [0, 1, 0], '', false, MODEL, { keepFolder: true });

    const row = await repo.findByEmail(1, MODEL);
    expect(row?.embedding).toEqual([0, 1, 0]);
    expect(row?.folder).toBe('Promotions');
    expect(row?.isCorrection).toBe(true);
  });

  it("keepFolder on a new row stores the unknown label ''", async () => {
    const repo = createEmbeddingRepo(getDb());
    await repo.save(1, [0, 1, 0], '', false, MODEL, { keepFolder: true });
    expect((await repo.findByEmail(1, MODEL))?.folder).toBe('');
  });

  it('keeps one row per (email, model): embeddings stay keyed by model id', async () => {
    const repo = createEmbeddingRepo(getDb());
    await repo.save(1, [1, 0, 0], 'Feed', false, MODEL);
    await repo.save(1, [0, 1, 0], 'Feed', false, 'all-MiniLM-L6-v2');

    expect(await repo.count()).toBe(2);
    expect((await repo.findByEmail(1, MODEL))?.embedding).toEqual([1, 0, 0]);
    expect((await repo.findByEmail(1, 'all-MiniLM-L6-v2'))?.embedding).toEqual([0, 1, 0]);
    expect((await repo.findAll(MODEL)).map((e) => e.embeddingModel)).toEqual([MODEL]);
  });
});
