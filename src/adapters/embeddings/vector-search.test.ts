/**
 * Vector Search Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as BetterSqlite3 from 'better-sqlite3';
import { createVectorSearch } from './vector-search';
import { createEmbeddingService } from './index';
import { createEmbeddingRepo } from './embedding-repo';
import * as fs from 'fs';
import * as path from 'path';

type Database = BetterSqlite3.Database;

describe('VectorSearch', () => {
  let db: Database;
  let embeddingService: ReturnType<typeof createEmbeddingService>;
  let embeddingRepo: ReturnType<typeof createEmbeddingRepo>;
  let vectorSearch: ReturnType<typeof createVectorSearch>;

  beforeEach(() => {
    // Create in-memory database with schema
    db = new (BetterSqlite3 as any).default(':memory:') as Database;

    // Load schema
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Create test account and emails
    db.prepare('INSERT INTO accounts (name, email, imap_host, imap_port, smtp_host, smtp_port, username) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('Test', 'test@example.com', 'imap.example.com', 993, 'smtp.example.com', 587, 'test');

    db.prepare('INSERT INTO folders (account_id, path, name) VALUES (?, ?, ?)')
      .run(1, 'INBOX', 'INBOX');

    // Initialize services
    embeddingService = createEmbeddingService();
    embeddingRepo = createEmbeddingRepo(db);
    vectorSearch = createVectorSearch(embeddingService, embeddingRepo);
  });

  it('should return empty results when no embeddings exist', async () => {
    const results = await vectorSearch.findSimilar('Test query', 5);
    expect(results).toEqual([]);
  });

  it('should find similar emails', async () => {
    // Index some emails
    await vectorSearch.indexEmail(1, 'Invoice for December payment', 'Paper-Trail/Invoices', false);
    await vectorSearch.indexEmail(2, 'Receipt for your order', 'Paper-Trail/Invoices', false);
    await vectorSearch.indexEmail(3, 'Meeting scheduled for tomorrow', 'INBOX', false);

    // Search for invoice-like text
    const results = await vectorSearch.findSimilar('Payment receipt', 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);

    // Invoice/receipt emails should be most similar
    expect(results[0].folder).toBe('Paper-Trail/Invoices');
  });

  it('should respect topK parameter', async () => {
    // Index 5 emails
    for (let i = 1; i <= 5; i++) {
      await vectorSearch.indexEmail(i, `Email ${i}`, 'INBOX', false);
    }

    const results3 = await vectorSearch.findSimilar('Test query', 3);
    expect(results3.length).toBe(3);

    const results2 = await vectorSearch.findSimilar('Test query', 2);
    expect(results2.length).toBe(2);
  });

  it('should mark corrections correctly', async () => {
    await vectorSearch.indexEmail(1, 'Newsletter from company', 'Feed', false);
    await vectorSearch.indexEmail(2, 'Newsletter update', 'Social', true); // User correction

    const results = await vectorSearch.findSimilar('Newsletter digest', 2);

    // Both should be found
    expect(results.length).toBe(2);

    // Find the correction
    const correction = results.find(r => r.emailId === 2);
    expect(correction?.wasCorrection).toBe(true);
  });

  it('should calculate confidence from neighbors', () => {
    const results = [
      { emailId: 1, folder: 'INBOX', similarity: 0.9, wasCorrection: false },
      { emailId: 2, folder: 'INBOX', similarity: 0.8, wasCorrection: false },
      { emailId: 3, folder: 'Feed', similarity: 0.7, wasCorrection: false },
    ];

    const confidence = vectorSearch.calculateConfidence(results);

    expect(confidence).not.toBeNull();
    expect(confidence?.folder).toBe('INBOX'); // INBOX has higher total weight
    expect(confidence?.confidence).toBeGreaterThan(0.5);
    expect(confidence?.confidence).toBeLessThanOrEqual(1.0);
  });

  it('should weight corrections higher in confidence calculation', () => {
    const resultsWithCorrection = [
      { emailId: 1, folder: 'INBOX', similarity: 0.7, wasCorrection: false },
      { emailId: 2, folder: 'Feed', similarity: 0.7, wasCorrection: true }, // Correction
    ];

    const confidence = vectorSearch.calculateConfidence(resultsWithCorrection);

    // Feed should win because correction is weighted 2x
    expect(confidence?.folder).toBe('Feed');
  });

  it('should return null confidence for empty results', () => {
    const confidence = vectorSearch.calculateConfidence([]);
    expect(confidence).toBeNull();
  });

  it('should update existing embeddings on re-index', async () => {
    // Index email
    await vectorSearch.indexEmail(1, 'Original text', 'INBOX', false);

    // Re-index same email with different folder
    await vectorSearch.indexEmail(1, 'Updated text', 'Feed', true);

    // Should have only one embedding
    const count = await embeddingRepo.count();
    expect(count).toBe(1);

    // Should have new values
    const embedding = await embeddingRepo.findByEmail(1);
    expect(embedding?.folder).toBe('Feed');
    expect(embedding?.isCorrection).toBe(true);
  });

  it('should handle special characters in email text', async () => {
    const specialText = 'Hello! 🎉 This is a test email with émojis and àccents.';
    await vectorSearch.indexEmail(1, specialText, 'INBOX', false);

    const results = await vectorSearch.findSimilar('test email', 1);
    expect(results.length).toBe(1);
  });

  it('should return results sorted by similarity', async () => {
    await vectorSearch.indexEmail(1, 'Invoice payment due', 'Paper-Trail/Invoices', false);
    await vectorSearch.indexEmail(2, 'Your receipt', 'Paper-Trail/Invoices', false);
    await vectorSearch.indexEmail(3, 'Random meeting', 'INBOX', false);

    const results = await vectorSearch.findSimilar('Invoice receipt', 3);

    // Should be sorted by similarity descending
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThanOrEqual(results[2].similarity);
  });
});
