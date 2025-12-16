import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTriageLogRepo } from './triage-log-repo';

describe('TriageLogRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createTriageLogRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE triage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        pattern_hint TEXT,
        llm_folder TEXT,
        llm_confidence REAL,
        pattern_agreed INTEGER,
        final_folder TEXT NOT NULL,
        source TEXT NOT NULL,
        reasoning TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    repo = createTriageLogRepo(() => db);
  });

  it('logs and retrieves by email', async () => {
    await repo.log({
      emailId: 100,
      accountId: 1,
      patternHint: 'INBOX',
      llmFolder: 'INBOX',
      llmConfidence: 0.95,
      patternAgreed: true,
      finalFolder: 'INBOX',
      source: 'llm',
      reasoning: 'Shipping notification detected',
    });

    const logs = await repo.findByEmail(100);
    expect(logs).toHaveLength(1);
    expect(logs[0].reasoning).toBe('Shipping notification detected');
  });

  it('finds recent logs', async () => {
    await repo.log({ emailId: 1, accountId: 1, patternHint: null, llmFolder: 'Feed', llmConfidence: 0.8, patternAgreed: null, finalFolder: 'Feed', source: 'llm', reasoning: null });
    await repo.log({ emailId: 2, accountId: 1, patternHint: null, llmFolder: 'Social', llmConfidence: 0.7, patternAgreed: null, finalFolder: 'Social', source: 'llm', reasoning: null });
    await repo.log({ emailId: 3, accountId: 2, patternHint: null, llmFolder: 'INBOX', llmConfidence: 0.9, patternAgreed: null, finalFolder: 'INBOX', source: 'llm', reasoning: null });

    const allRecent = await repo.findRecent(10);
    expect(allRecent).toHaveLength(3);

    const account1 = await repo.findRecent(10, 1);
    expect(account1).toHaveLength(2);
  });
});
