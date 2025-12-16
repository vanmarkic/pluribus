import type Database from 'better-sqlite3';
import type { SenderRuleRepo } from '../../core/ports';
import type { SenderRule, TriageFolder } from '../../core/domain';

export function createSenderRulesRepo(getDb: () => Database.Database): SenderRuleRepo {
  return {
    async findByAccount(accountId: number): Promise<SenderRule[]> {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM sender_rules WHERE account_id = ? ORDER BY correction_count DESC
      `).all(accountId) as any[];
      return rows.map(mapRow);
    },

    async findAutoApply(accountId: number): Promise<SenderRule[]> {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM sender_rules WHERE account_id = ? AND auto_apply = 1 ORDER BY confidence DESC
      `).all(accountId) as any[];
      return rows.map(mapRow);
    },

    async findByPattern(accountId: number, pattern: string, patternType: string): Promise<SenderRule | null> {
      const db = getDb();
      const row = db.prepare(`
        SELECT * FROM sender_rules WHERE account_id = ? AND pattern = ? AND pattern_type = ?
      `).get(accountId, pattern, patternType) as any;
      return row ? mapRow(row) : null;
    },

    async upsert(rule: Omit<SenderRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<SenderRule> {
      const db = getDb();
      db.prepare(`
        INSERT INTO sender_rules (account_id, pattern, pattern_type, target_folder, confidence, correction_count, auto_apply)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, pattern, pattern_type) DO UPDATE SET
          target_folder = excluded.target_folder,
          confidence = excluded.confidence,
          correction_count = excluded.correction_count,
          auto_apply = excluded.auto_apply,
          updated_at = datetime('now')
      `).run(
        rule.accountId,
        rule.pattern,
        rule.patternType,
        rule.targetFolder,
        rule.confidence,
        rule.correctionCount,
        rule.autoApply ? 1 : 0
      );

      // Fetch the complete row with actual timestamps
      const row = db.prepare(`
        SELECT * FROM sender_rules WHERE account_id = ? AND pattern = ? AND pattern_type = ?
      `).get(rule.accountId, rule.pattern, rule.patternType) as any;

      if (!row) {
        throw new Error(`Failed to retrieve sender rule after upsert: ${rule.pattern}`);
      }

      return mapRow(row);
    },

    async incrementCount(id: number): Promise<void> {
      const db = getDb();
      db.prepare(`
        UPDATE sender_rules SET correction_count = correction_count + 1, updated_at = datetime('now') WHERE id = ?
      `).run(id);
    },
  };
}

function mapRow(row: any): SenderRule {
  return {
    id: row.id,
    accountId: row.account_id,
    pattern: row.pattern,
    patternType: row.pattern_type as SenderRule['patternType'],
    targetFolder: row.target_folder as TriageFolder,
    confidence: row.confidence,
    correctionCount: row.correction_count,
    autoApply: Boolean(row.auto_apply),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
