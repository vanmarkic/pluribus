/**
 * Email Repository
 *
 * Implements EmailRepo port from core/ports.ts using SQLite.
 */

import type { EmailRepo, ListEmailsOptions } from '../../core/ports';
import type { Email, EmailBody } from '../../core/domain';
import { getDb, escapeLike, escapeFtsQuery, checkIntegrity } from './connection';
import { mapEmail } from './mappers';

export function createEmailRepo(): EmailRepo {
  return {
    async findById(id) {
      const row = getDb().prepare(`
        SELECT * FROM emails WHERE id = ?
      `).get(id);
      return row ? mapEmail(row) : null;
    },

    async list(options: ListEmailsOptions = {}) {
      // tagId removed - using folders for organization (Issue #54)
      const { accountId, folderId, folderPath, unreadOnly, starredOnly, limit = 100, offset = 0 } = options;

      const conditions: string[] = [];
      const params: any[] = [];
      const joins: string[] = [];

      if (accountId) {
        conditions.push('e.account_id = ?');
        params.push(accountId);
      }
      if (folderId) {
        conditions.push('e.folder_id = ?');
        params.push(folderId);
      }
      if (folderPath) {
        // Join with folders table to filter by folder path pattern
        joins.push('JOIN folders f ON e.folder_id = f.id');
        // Match folder path containing the pattern (e.g., 'Sent' matches 'Sent', 'Sent Items', '[Gmail]/Sent Mail')
        // Escape LIKE special characters to prevent SQL injection
        conditions.push("f.path LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(folderPath)}%`);
      }
      if (unreadOnly) conditions.push('e.is_read = 0');
      if (starredOnly) conditions.push('e.is_starred = 1');

      const joinClause = joins.length ? joins.join(' ') : '';
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const rows = getDb().prepare(`
        SELECT e.* FROM emails e ${joinClause} ${where}
        ORDER BY e.date DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      return rows.map(mapEmail);
    },

    async search(query, limit = 100, accountId?: number) {
      // Use the escapeFtsQuery utility to sanitize input
      const ftsQuery = escapeFtsQuery(query);
      if (!ftsQuery) return [];

      // Build query with optional account filter
      let sql = `
        SELECT e.* FROM emails e
        JOIN emails_fts fts ON e.id = fts.rowid
        WHERE emails_fts MATCH ?
      `;
      const params: any[] = [ftsQuery];

      if (accountId) {
        sql += ' AND e.account_id = ?';
        params.push(accountId);
      }

      sql += ' ORDER BY rank LIMIT ?';
      params.push(Math.min(limit, 500));

      const rows = getDb().prepare(sql).all(...params);
      return rows.map(mapEmail);
    },

    async getBody(id) {
      const row = getDb().prepare(`
        SELECT body_text, body_html FROM email_bodies WHERE email_id = ?
      `).get(id) as { body_text: string; body_html: string } | undefined;
      return row ? { text: row.body_text || '', html: row.body_html || '' } : null;
    },

    async saveBody(id, body) {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO email_bodies (email_id, body_text, body_html)
        VALUES (?, ?, ?)
      `).run(id, body.text, body.html);

      db.prepare(`
        UPDATE emails SET body_fetched = 1, snippet = ? WHERE id = ?
      `).run(body.text.slice(0, 200), id);
    },

    async insert(email) {
      const result = getDb().prepare(`
        INSERT INTO emails (
          message_id, account_id, folder_id, uid, subject,
          from_address, from_name, to_addresses, date, snippet,
          size_bytes, is_read, is_starred, has_attachments, body_fetched,
          in_reply_to, references, thread_id, list_unsubscribe, list_unsubscribe_post
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        email.messageId, email.accountId, email.folderId, email.uid, email.subject,
        email.from.address, email.from.name, JSON.stringify(email.to),
        email.date.toISOString(), email.snippet, email.sizeBytes,
        email.isRead ? 1 : 0, email.isStarred ? 1 : 0,
        email.hasAttachments ? 1 : 0, email.bodyFetched ? 1 : 0,
        email.inReplyTo, email.references, email.threadId,
        email.listUnsubscribe, email.listUnsubscribePost
      );
      return { ...email, id: result.lastInsertRowid as number };
    },

    async insertBatch(emails) {
      const stmt = getDb().prepare(`
        INSERT OR IGNORE INTO emails (
          message_id, account_id, folder_id, uid, subject,
          from_address, from_name, to_addresses, date, snippet,
          size_bytes, is_read, is_starred, has_attachments, body_fetched,
          in_reply_to, references, thread_id, list_unsubscribe, list_unsubscribe_post
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const newIds: number[] = [];
      const transaction = getDb().transaction(() => {
        for (const e of emails) {
          const r = stmt.run(
            e.messageId, e.accountId, e.folderId, e.uid, e.subject,
            e.from.address, e.from.name, JSON.stringify(e.to),
            e.date.toISOString(), e.snippet, e.sizeBytes,
            e.isRead ? 1 : 0, e.isStarred ? 1 : 0,
            e.hasAttachments ? 1 : 0, e.bodyFetched ? 1 : 0,
            e.inReplyTo, e.references, e.threadId,
            e.listUnsubscribe, e.listUnsubscribePost
          );
          if (r.changes > 0) {
            newIds.push(r.lastInsertRowid as number);
          }
        }
      });
      transaction();
      return { count: newIds.length, ids: newIds };
    },

    async markRead(id, isRead) {
      getDb().prepare('UPDATE emails SET is_read = ? WHERE id = ?').run(isRead ? 1 : 0, id);
    },

    async setStar(id, isStarred) {
      getDb().prepare('UPDATE emails SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, id);
    },

    async setFolderId(id, folderId) {
      getDb().prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(folderId, id);
    },

    async delete(id) {
      // Use transaction to ensure atomicity with CASCADE deletes
      const db = getDb();
      try {
        const deleteTransaction = db.transaction(() => {
          db.prepare('DELETE FROM emails WHERE id = ?').run(id);
        });
        deleteTransaction();
      } catch (error) {
        // If deletion fails, it could be due to database corruption
        // Check integrity and provide helpful error message
        if (error instanceof Error && error.message.includes('malformed')) {
          const integrityResult = await checkIntegrity(false);
          if (!integrityResult.isHealthy) {
            throw new Error(
              `Database corruption detected during delete operation: ${integrityResult.errors.join('; ')}. ` +
              `Consider running database integrity check and backup.`
            );
          }
        }
        throw error;
      }
    },
  };
}
