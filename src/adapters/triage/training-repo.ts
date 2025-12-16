import type Database from 'better-sqlite3';
import type { TrainingRepo } from '../../core/ports';
import type { TrainingExample, Email } from '../../core/domain';

/**
 * Training Repository
 *
 * Stores user training examples for triage classification.
 * Examples include onboarding data, folder reviews, and manual corrections.
 * Used by the AI classifier to learn user preferences.
 */
export function createTrainingRepo(getDb: () => Database.Database): TrainingRepo {
  return {
    async findByAccount(accountId: number, limit = 50): Promise<TrainingExample[]> {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM training_examples
        WHERE account_id = ?
        ORDER BY was_correction DESC, created_at DESC
        LIMIT ?
      `).all(accountId, limit) as any[];
      return rows.map(mapRow);
    },

    async findByDomain(accountId: number, domain: string, limit = 10): Promise<TrainingExample[]> {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM training_examples
        WHERE account_id = ? AND from_domain = ?
        ORDER BY was_correction DESC, created_at DESC
        LIMIT ?
      `).all(accountId, domain, limit) as any[];
      return rows.map(mapRow);
    },

    async save(example: Omit<TrainingExample, 'id' | 'createdAt'>): Promise<TrainingExample> {
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO training_examples (account_id, email_id, from_address, from_domain, subject, ai_suggestion, user_choice, was_correction, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        example.accountId,
        example.emailId,
        example.fromAddress,
        example.fromDomain,
        example.subject,
        example.aiSuggestion,
        example.userChoice,
        example.wasCorrection ? 1 : 0,
        example.source
      );
      return {
        ...example,
        id: result.lastInsertRowid as number,
        createdAt: new Date(),
      };
    },

    async getRelevantExamples(accountId: number, email: Email, limit = 10): Promise<TrainingExample[]> {
      const db = getDb();
      const domain = email.from.address.split('@')[1] || '';

      const rows = db.prepare(`
        SELECT *,
          CASE
            WHEN from_domain = ? AND was_correction = 1 THEN 3
            WHEN from_domain = ? AND was_correction = 0 THEN 2
            WHEN was_correction = 1 THEN 1
            ELSE 0
          END as relevance
        FROM training_examples
        WHERE account_id = ?
        ORDER BY relevance DESC, created_at DESC
        LIMIT ?
      `).all(domain, domain, accountId, limit) as any[];

      return rows.map(mapRow);
    },
  };
}

function mapRow(row: any): TrainingExample {
  return {
    id: row.id,
    accountId: row.account_id,
    emailId: row.email_id,
    fromAddress: row.from_address,
    fromDomain: row.from_domain,
    subject: row.subject,
    aiSuggestion: row.ai_suggestion,
    userChoice: row.user_choice,
    wasCorrection: Boolean(row.was_correction),
    source: row.source as TrainingExample['source'],
    createdAt: new Date(row.created_at),
  };
}
