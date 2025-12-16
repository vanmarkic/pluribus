import type Database from 'better-sqlite3';
import type { TriageLogRepo } from '../../core/ports';
import type { TriageLogEntry } from '../../core/domain';

export function createTriageLogRepo(getDb: () => Database.Database): TriageLogRepo {
  return {
    async log(entry: Omit<TriageLogEntry, 'id' | 'createdAt'>): Promise<void> {
      const db = getDb();
      db.prepare(`
        INSERT INTO triage_log (email_id, account_id, pattern_hint, llm_folder, llm_confidence, pattern_agreed, final_folder, source, reasoning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.emailId,
        entry.accountId,
        entry.patternHint,
        entry.llmFolder,
        entry.llmConfidence,
        entry.patternAgreed === null ? null : entry.patternAgreed ? 1 : 0,
        entry.finalFolder,
        entry.source,
        entry.reasoning
      );
    },

    async findByEmail(emailId: number): Promise<TriageLogEntry[]> {
      const db = getDb();
      const rows = db.prepare(`SELECT * FROM triage_log WHERE email_id = ? ORDER BY created_at DESC`).all(emailId) as any[];
      return rows.map(mapRow);
    },

    async findRecent(limit = 50, accountId?: number): Promise<TriageLogEntry[]> {
      const db = getDb();
      if (accountId !== undefined) {
        const rows = db.prepare(`SELECT * FROM triage_log WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`).all(accountId, limit) as any[];
        return rows.map(mapRow);
      } else {
        const rows = db.prepare(`SELECT * FROM triage_log ORDER BY created_at DESC LIMIT ?`).all(limit) as any[];
        return rows.map(mapRow);
      }
    },
  };
}

function mapRow(row: any): TriageLogEntry {
  return {
    id: row.id,
    emailId: row.email_id,
    accountId: row.account_id,
    patternHint: row.pattern_hint,
    llmFolder: row.llm_folder,
    llmConfidence: row.llm_confidence,
    patternAgreed: row.pattern_agreed === null ? null : Boolean(row.pattern_agreed),
    finalFolder: row.final_folder,
    source: row.source as TriageLogEntry['source'],
    reasoning: row.reasoning,
    createdAt: new Date(row.created_at),
  };
}
