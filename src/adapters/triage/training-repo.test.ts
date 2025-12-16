import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTrainingRepo } from './training-repo';

describe('TrainingRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createTrainingRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE training_examples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        email_id INTEGER,
        from_address TEXT NOT NULL,
        from_domain TEXT NOT NULL,
        subject TEXT NOT NULL,
        ai_suggestion TEXT,
        user_choice TEXT NOT NULL,
        was_correction INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    repo = createTrainingRepo(() => db);
  });

  it('saves and retrieves training examples', async () => {
    const example = await repo.save({
      accountId: 1,
      emailId: 100,
      fromAddress: 'test@amazon.com',
      fromDomain: 'amazon.com',
      subject: 'Your order shipped',
      aiSuggestion: 'INBOX',
      userChoice: 'INBOX',
      wasCorrection: false,
      source: 'onboarding',
    });

    expect(example.id).toBeDefined();

    const results = await repo.findByAccount(1);
    expect(results).toHaveLength(1);
    expect(results[0].fromDomain).toBe('amazon.com');
  });

  it('finds examples by domain', async () => {
    await repo.save({
      accountId: 1, emailId: 1, fromAddress: 'a@amazon.com', fromDomain: 'amazon.com',
      subject: 'Order 1', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });
    await repo.save({
      accountId: 1, emailId: 2, fromAddress: 'b@linkedin.com', fromDomain: 'linkedin.com',
      subject: 'Connection', aiSuggestion: null, userChoice: 'Social', wasCorrection: false, source: 'onboarding',
    });

    const amazonExamples = await repo.findByDomain(1, 'amazon.com');
    expect(amazonExamples).toHaveLength(1);
    expect(amazonExamples[0].fromAddress).toBe('a@amazon.com');
  });

  it('prioritizes corrections in findByAccount', async () => {
    await repo.save({
      accountId: 1, emailId: 1, fromAddress: 'a@test.com', fromDomain: 'test.com',
      subject: 'Normal', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });
    await repo.save({
      accountId: 1, emailId: 2, fromAddress: 'b@test.com', fromDomain: 'test.com',
      subject: 'Corrected', aiSuggestion: 'INBOX', userChoice: 'Feed', wasCorrection: true, source: 'manual_move',
    });

    const results = await repo.findByAccount(1);
    expect(results).toHaveLength(2);
    expect(results[0].wasCorrection).toBe(true);
    expect(results[0].subject).toBe('Corrected');
  });

  it('returns empty array for account with no examples', async () => {
    const results = await repo.findByAccount(999);
    expect(results).toHaveLength(0);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 15; i++) {
      await repo.save({
        accountId: 1, emailId: i, fromAddress: `test${i}@example.com`, fromDomain: 'example.com',
        subject: `Test ${i}`, aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
      });
    }

    const results = await repo.findByAccount(1, 5);
    expect(results).toHaveLength(5);
  });

  it('getRelevantExamples prioritizes matching domain with corrections', async () => {
    await repo.save({
      accountId: 1, emailId: 1, fromAddress: 'a@amazon.com', fromDomain: 'amazon.com',
      subject: 'Order', aiSuggestion: 'INBOX', userChoice: 'Archive', wasCorrection: true, source: 'manual_move',
    });
    await repo.save({
      accountId: 1, emailId: 2, fromAddress: 'b@amazon.com', fromDomain: 'amazon.com',
      subject: 'Delivery', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });
    await repo.save({
      accountId: 1, emailId: 3, fromAddress: 'c@other.com', fromDomain: 'other.com',
      subject: 'Other', aiSuggestion: 'Feed', userChoice: 'INBOX', wasCorrection: true, source: 'manual_move',
    });

    const email = {
      id: 100,
      from: { address: 'test@amazon.com', name: null },
    } as any;

    const results = await repo.getRelevantExamples(1, email, 10);
    expect(results.length).toBeGreaterThan(0);
    // Most relevant: same domain + correction
    expect(results[0].fromDomain).toBe('amazon.com');
    expect(results[0].wasCorrection).toBe(true);
  });

  it('getRelevantExamples handles email without domain', async () => {
    await repo.save({
      accountId: 1, emailId: 1, fromAddress: 'test@example.com', fromDomain: 'example.com',
      subject: 'Test', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });

    const email = {
      id: 100,
      from: { address: 'nodomain', name: null },
    } as any;

    const results = await repo.getRelevantExamples(1, email, 10);
    // Should still return examples even with invalid email format
    expect(results).toHaveLength(1);
  });

  it('isolates examples by account', async () => {
    await repo.save({
      accountId: 1, emailId: 1, fromAddress: 'a@test.com', fromDomain: 'test.com',
      subject: 'Account 1', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });
    await repo.save({
      accountId: 2, emailId: 2, fromAddress: 'b@test.com', fromDomain: 'test.com',
      subject: 'Account 2', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });

    const account1Results = await repo.findByAccount(1);
    const account2Results = await repo.findByAccount(2);

    expect(account1Results).toHaveLength(1);
    expect(account2Results).toHaveLength(1);
    expect(account1Results[0].subject).toBe('Account 1');
    expect(account2Results[0].subject).toBe('Account 2');
  });
});
