import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createSnoozeRepo } from './snooze-repo';

describe('SnoozeRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createSnoozeRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE email_snoozes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id INTEGER NOT NULL,
        snooze_until TEXT NOT NULL,
        original_folder TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(email_id)
      )
    `);
    repo = createSnoozeRepo(() => db);
  });

  it('creates and finds snooze by email', async () => {
    const futureDate = new Date(Date.now() + 3600000);
    const snooze = await repo.create({
      emailId: 100,
      snoozeUntil: futureDate,
      originalFolder: 'INBOX',
      reason: 'shipping',
    });

    expect(snooze.id).toBeDefined();

    const found = await repo.findByEmail(100);
    expect(found).not.toBeNull();
    expect(found!.reason).toBe('shipping');
  });

  it('finds due snoozes', async () => {
    const past = new Date(Date.now() - 3600000);
    const future = new Date(Date.now() + 3600000);

    await repo.create({ emailId: 1, snoozeUntil: past, originalFolder: 'INBOX', reason: 'manual' });
    await repo.create({ emailId: 2, snoozeUntil: future, originalFolder: 'INBOX', reason: 'manual' });

    const due = await repo.findDue();
    expect(due).toHaveLength(1);
    expect(due[0].emailId).toBe(1);
  });

  it('deletes snooze', async () => {
    await repo.create({ emailId: 50, snoozeUntil: new Date(), originalFolder: 'INBOX', reason: 'manual' });

    await repo.delete(50);

    const found = await repo.findByEmail(50);
    expect(found).toBeNull();
  });
});
