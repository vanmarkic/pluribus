import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createSenderRulesRepo } from './sender-rules-repo';

describe('SenderRulesRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createSenderRulesRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sender_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        pattern TEXT NOT NULL,
        pattern_type TEXT NOT NULL DEFAULT 'domain',
        target_folder TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        correction_count INTEGER NOT NULL DEFAULT 1,
        auto_apply INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, pattern, pattern_type)
      )
    `);
    repo = createSenderRulesRepo(() => db);
  });

  it('creates and updates rules via upsert', async () => {
    const rule = await repo.upsert({
      accountId: 1,
      pattern: 'amazon.com',
      patternType: 'domain',
      targetFolder: 'Paper-Trail/Invoices',
      confidence: 0.8,
      correctionCount: 1,
      autoApply: false,
    });

    expect(rule.id).toBeDefined();

    const updated = await repo.upsert({
      accountId: 1,
      pattern: 'amazon.com',
      patternType: 'domain',
      targetFolder: 'Paper-Trail/Invoices',
      confidence: 0.9,
      correctionCount: 3,
      autoApply: true,
    });

    expect(updated.id).toBe(rule.id);
    expect(updated.autoApply).toBe(true);
  });

  it('finds auto-apply rules', async () => {
    await repo.upsert({ accountId: 1, pattern: 'a.com', patternType: 'domain', targetFolder: 'INBOX', confidence: 0.9, correctionCount: 5, autoApply: true });
    await repo.upsert({ accountId: 1, pattern: 'b.com', patternType: 'domain', targetFolder: 'INBOX', confidence: 0.7, correctionCount: 2, autoApply: false });

    const autoRules = await repo.findAutoApply(1);
    expect(autoRules).toHaveLength(1);
    expect(autoRules[0].pattern).toBe('a.com');
  });

  it('finds rule by pattern', async () => {
    await repo.upsert({ accountId: 1, pattern: 'test.com', patternType: 'domain', targetFolder: 'Feed', confidence: 0.8, correctionCount: 1, autoApply: false });

    const found = await repo.findByPattern(1, 'test.com', 'domain');
    expect(found).not.toBeNull();
    expect(found!.targetFolder).toBe('Feed');

    const notFound = await repo.findByPattern(1, 'other.com', 'domain');
    expect(notFound).toBeNull();
  });

  it('increments correction count', async () => {
    const rule = await repo.upsert({ accountId: 1, pattern: 'inc.com', patternType: 'domain', targetFolder: 'INBOX', confidence: 0.8, correctionCount: 1, autoApply: false });

    await repo.incrementCount(rule.id);

    const rules = await repo.findByAccount(1);
    expect(rules[0].correctionCount).toBe(2);
  });
});
