/**
 * Account Repository
 *
 * Implements AccountRepo port from core/ports.ts using SQLite.
 */

import type { AccountRepo, AccountInput } from '../../core/ports';
import type { Account } from '../../core/domain';
import { getDb } from './connection';
import { mapAccount } from './mappers';

export function createAccountRepo(): AccountRepo {
  return {
    async findAll() {
      return getDb().prepare('SELECT * FROM accounts WHERE is_active = 1').all().map(mapAccount);
    },

    async findById(id) {
      const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
      return row ? mapAccount(row) : null;
    },

    async findByEmail(email) {
      const row = getDb().prepare('SELECT * FROM accounts WHERE email = ?').get(email);
      return row ? mapAccount(row) : null;
    },

    async create(account) {
      const result = getDb().prepare(`
        INSERT INTO accounts (name, email, imap_host, imap_port, smtp_host, smtp_port, username, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        account.name,
        account.email,
        account.imapHost,
        account.imapPort,
        account.smtpHost,
        account.smtpPort,
        account.username,
        account.isActive !== false ? 1 : 0
      );

      return {
        id: result.lastInsertRowid as number,
        name: account.name,
        email: account.email,
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        username: account.username,
        isActive: account.isActive !== false,
        lastSync: null,
      };
    },

    async update(id, account) {
      const fields: string[] = [];
      const values: any[] = [];

      if (account.name !== undefined) { fields.push('name = ?'); values.push(account.name); }
      if (account.email !== undefined) { fields.push('email = ?'); values.push(account.email); }
      if (account.imapHost !== undefined) { fields.push('imap_host = ?'); values.push(account.imapHost); }
      if (account.imapPort !== undefined) { fields.push('imap_port = ?'); values.push(account.imapPort); }
      if (account.smtpHost !== undefined) { fields.push('smtp_host = ?'); values.push(account.smtpHost); }
      if (account.smtpPort !== undefined) { fields.push('smtp_port = ?'); values.push(account.smtpPort); }
      if (account.username !== undefined) { fields.push('username = ?'); values.push(account.username); }
      if (account.isActive !== undefined) { fields.push('is_active = ?'); values.push(account.isActive ? 1 : 0); }

      if (fields.length > 0) {
        values.push(id);
        getDb().prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }

      const updated = await this.findById(id);
      if (!updated) throw new Error('Account not found');
      return updated;
    },

    async delete(id) {
      // Soft delete - just mark inactive
      getDb().prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(id);
    },

    async updateLastSync(id) {
      getDb().prepare("UPDATE accounts SET last_sync = datetime('now') WHERE id = ?").run(id);
    },
  };
}
