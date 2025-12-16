import type Database from 'better-sqlite3';
import type { SnoozeRepo } from '../../core/ports';
import type { EmailSnooze } from '../../core/domain';

export function createSnoozeRepo(getDb: () => Database.Database): SnoozeRepo {
  return {
    async findByEmail(emailId: number): Promise<EmailSnooze | null> {
      const db = getDb();
      const row = db.prepare(`SELECT * FROM email_snoozes WHERE email_id = ?`).get(emailId) as any;
      return row ? mapRow(row) : null;
    },

    async findDue(): Promise<EmailSnooze[]> {
      const db = getDb();
      const now = new Date().toISOString();
      const rows = db.prepare(`
        SELECT * FROM email_snoozes WHERE snooze_until <= ? ORDER BY snooze_until ASC
      `).all(now) as any[];
      return rows.map(mapRow);
    },

    async create(snooze: Omit<EmailSnooze, 'id' | 'createdAt'>): Promise<EmailSnooze> {
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO email_snoozes (email_id, snooze_until, original_folder, reason)
        VALUES (?, ?, ?, ?)
      `).run(
        snooze.emailId,
        snooze.snoozeUntil.toISOString(),
        snooze.originalFolder,
        snooze.reason
      );
      return {
        ...snooze,
        id: result.lastInsertRowid as number,
        createdAt: new Date(),
      };
    },

    async delete(emailId: number): Promise<void> {
      const db = getDb();
      db.prepare(`DELETE FROM email_snoozes WHERE email_id = ?`).run(emailId);
    },
  };
}

function mapRow(row: any): EmailSnooze {
  return {
    id: row.id,
    emailId: row.email_id,
    snoozeUntil: new Date(row.snooze_until),
    originalFolder: row.original_folder,
    reason: row.reason as EmailSnooze['reason'],
    createdAt: new Date(row.created_at),
  };
}
