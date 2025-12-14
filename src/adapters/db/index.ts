/**
 * SQLite Database Adapter
 * 
 * Implements all repository ports using better-sqlite3.
 * Single file, all repos - keeps it simple.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { EmailRepo, AttachmentRepo, TagRepo, AccountRepo, FolderRepo } from '../../core/ports';
import type { Email, EmailBody, Attachment, Tag, AppliedTag, Account, Folder, ListEmailsOptions } from '../../core/domain';

// ============================================
// Connection
// ============================================

let db: Database.Database | null = null;

export function initDb(dbPath: string, schemaPath?: string): Database.Database {
  if (db) return db;

  // Poka-yoke: Fail fast if schema path provided but file doesn't exist
  if (schemaPath && !fs.existsSync(schemaPath)) {
    throw new Error(`Database schema not found: ${schemaPath}`);
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');

  if (schemaPath) {
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  }

  // Poka-yoke: Verify critical tables exist after schema load
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = tables.map(t => t.name);
  const requiredTables = ['accounts', 'folders', 'emails', 'tags'];
  const missing = requiredTables.filter(t => !tableNames.includes(t));
  if (missing.length > 0) {
    throw new Error(`Database schema incomplete - missing tables: ${missing.join(', ')}`);
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

// ============================================
// Row Mappers (DB -> Domain)
// ============================================

function mapEmail(row: any): Email {
  return {
    id: row.id,
    messageId: row.message_id,
    accountId: row.account_id,
    folderId: row.folder_id,
    uid: row.uid,
    subject: row.subject || '',
    from: { address: row.from_address, name: row.from_name },
    to: JSON.parse(row.to_addresses || '[]'),
    date: new Date(row.date),
    snippet: row.snippet || '',
    sizeBytes: row.size_bytes,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    hasAttachments: Boolean(row.has_attachments),
    bodyFetched: Boolean(row.body_fetched),
  };
}

function mapTag(row: any): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    isSystem: Boolean(row.is_system),
    sortOrder: row.sort_order,
  };
}

function mapAccount(row: any): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    username: row.username,
    isActive: Boolean(row.is_active),
    lastSync: row.last_sync ? new Date(row.last_sync) : null,
  };
}

function mapFolder(row: any): Folder {
  return {
    id: row.id,
    accountId: row.account_id,
    path: row.path,
    name: row.name,
    uidValidity: row.uid_validity,
    lastUid: row.last_uid,
  };
}

function mapAttachment(row: any): Attachment {
  return {
    id: row.id,
    emailId: row.email_id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    cid: row.cid || undefined,
  };
}

// ============================================
// Email Repository
// ============================================

export function createEmailRepo(): EmailRepo {
  return {
    async findById(id) {
      const row = getDb().prepare(`
        SELECT * FROM emails WHERE id = ?
      `).get(id);
      return row ? mapEmail(row) : null;
    },

    async list(options: ListEmailsOptions = {}) {
      const { tagId, folderId, folderPath, unreadOnly, starredOnly, limit = 100, offset = 0 } = options;

      const conditions: string[] = [];
      const params: any[] = [];
      const joins: string[] = [];

      if (tagId) {
        conditions.push('EXISTS (SELECT 1 FROM email_tags WHERE email_id = e.id AND tag_id = ?)');
        params.push(tagId);
      }
      if (folderId) {
        conditions.push('e.folder_id = ?');
        params.push(folderId);
      }
      if (folderPath) {
        // Join with folders table to filter by folder path pattern
        joins.push('JOIN folders f ON e.folder_id = f.id');
        // Match folder path containing the pattern (e.g., 'Sent' matches 'Sent', 'Sent Items', '[Gmail]/Sent Mail')
        conditions.push('f.path LIKE ?');
        params.push(`%${folderPath}%`);
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

    async search(query, limit = 100) {
      // Sanitize FTS query to prevent DoS via complex patterns
      // Remove special FTS operators and limit wildcards
      const sanitized = query
        .replace(/[*"(){}[\]^~\\]/g, ' ')  // Remove FTS special chars
        .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')  // Remove boolean operators
        .trim()
        .slice(0, 200);  // Limit query length

      if (!sanitized) return [];

      // Use simple prefix matching with sanitized terms
      const terms = sanitized.split(/\s+/).filter(t => t.length >= 2).slice(0, 10);
      if (terms.length === 0) return [];

      const ftsQuery = terms.map(t => `"${t}"*`).join(' ');

      const rows = getDb().prepare(`
        SELECT e.* FROM emails e
        JOIN emails_fts fts ON e.id = fts.rowid
        WHERE emails_fts MATCH ?
        ORDER BY rank LIMIT ?
      `).all(ftsQuery, Math.min(limit, 500));
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
          size_bytes, is_read, is_starred, has_attachments, body_fetched
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        email.messageId, email.accountId, email.folderId, email.uid, email.subject,
        email.from.address, email.from.name, JSON.stringify(email.to),
        email.date.toISOString(), email.snippet, email.sizeBytes,
        email.isRead ? 1 : 0, email.isStarred ? 1 : 0,
        email.hasAttachments ? 1 : 0, email.bodyFetched ? 1 : 0
      );
      return { ...email, id: result.lastInsertRowid as number };
    },

    async insertBatch(emails) {
      const stmt = getDb().prepare(`
        INSERT OR IGNORE INTO emails (
          message_id, account_id, folder_id, uid, subject,
          from_address, from_name, to_addresses, date, snippet,
          size_bytes, is_read, is_starred, has_attachments, body_fetched
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const newIds: number[] = [];
      const transaction = getDb().transaction(() => {
        for (const e of emails) {
          const r = stmt.run(
            e.messageId, e.accountId, e.folderId, e.uid, e.subject,
            e.from.address, e.from.name, JSON.stringify(e.to),
            e.date.toISOString(), e.snippet, e.sizeBytes,
            e.isRead ? 1 : 0, e.isStarred ? 1 : 0,
            e.hasAttachments ? 1 : 0, e.bodyFetched ? 1 : 0
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

    async delete(id) {
      getDb().prepare('DELETE FROM emails WHERE id = ?').run(id);
    },
  };
}

// ============================================
// Attachment Repository
// ============================================

export function createAttachmentRepo(): AttachmentRepo {
  return {
    async findById(id) {
      const row = getDb().prepare(`
        SELECT id, email_id, filename, content_type, size, cid
        FROM attachments WHERE id = ?
      `).get(id);
      return row ? mapAttachment(row) : null;
    },

    async findByEmailId(emailId) {
      const rows = getDb().prepare(`
        SELECT id, email_id, filename, content_type, size, cid
        FROM attachments WHERE email_id = ?
        ORDER BY id
      `).all(emailId);
      return rows.map(mapAttachment);
    },

    async save(attachment) {
      const { content, ...attachmentData } = attachment as any;
      const result = getDb().prepare(`
        INSERT INTO attachments (email_id, filename, content_type, size, cid, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        attachmentData.emailId,
        attachmentData.filename,
        attachmentData.contentType,
        attachmentData.size,
        attachmentData.cid || null,
        content
      );
      return {
        ...attachmentData,
        id: result.lastInsertRowid as number,
      };
    },

    async getContent(id) {
      const row = getDb().prepare(`
        SELECT content FROM attachments WHERE id = ?
      `).get(id) as { content: Buffer } | undefined;
      return row ? row.content : null;
    },
  };
}

// ============================================
// Tag Repository
// ============================================

export function createTagRepo(): TagRepo {
  return {
    async findAll() {
      return getDb().prepare('SELECT * FROM tags ORDER BY sort_order, name').all().map(mapTag);
    },

    async findBySlug(slug) {
      const row = getDb().prepare('SELECT * FROM tags WHERE slug = ?').get(slug);
      return row ? mapTag(row) : null;
    },

    async findByEmailId(emailId) {
      const rows = getDb().prepare(`
        SELECT t.*, et.source, et.confidence
        FROM tags t
        JOIN email_tags et ON t.id = et.tag_id
        WHERE et.email_id = ?
        ORDER BY t.sort_order
      `).all(emailId);
      
      return rows.map(row => ({
        ...mapTag(row),
        source: (row as any).source,
        confidence: (row as any).confidence,
      }));
    },

    async apply(emailId, tagId, source, confidence) {
      getDb().prepare(`
        INSERT OR REPLACE INTO email_tags (email_id, tag_id, source, confidence)
        VALUES (?, ?, ?, ?)
      `).run(emailId, tagId, source, confidence ?? null);
    },

    async remove(emailId, tagId) {
      getDb().prepare('DELETE FROM email_tags WHERE email_id = ? AND tag_id = ?').run(emailId, tagId);
    },

    async create(tag) {
      const result = getDb().prepare(`
        INSERT INTO tags (name, slug, color, is_system, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(tag.name, tag.slug, tag.color, tag.isSystem ? 1 : 0, tag.sortOrder);
      return { ...tag, id: result.lastInsertRowid as number };
    },
  };
}

// ============================================
// Account Repository
// ============================================

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
      getDb().prepare('UPDATE accounts SET last_sync = datetime("now") WHERE id = ?').run(id);
    },
  };
}

// ============================================
// Folder Repository
// ============================================

export function createFolderRepo(): FolderRepo {
  return {
    async getOrCreate(accountId, path, name, uidValidity) {
      // Poka-yoke: Reject invalid account IDs before they cause FK violations
      if (!accountId || accountId <= 0) {
        throw new Error(`Invalid accountId: ${accountId}. Cannot create folder for non-existent account.`);
      }

      let row = getDb().prepare(`
        SELECT * FROM folders WHERE account_id = ? AND path = ?
      `).get(accountId, path);

      if (!row) {
        const result = getDb().prepare(`
          INSERT INTO folders (account_id, path, name, uid_validity, last_uid)
          VALUES (?, ?, ?, ?, 0)
        `).run(accountId, path, name, uidValidity ?? null);

        return {
          id: result.lastInsertRowid as number,
          accountId, path, name,
          uidValidity: uidValidity ?? null,
          lastUid: 0,
        };
      }

      return mapFolder(row);
    },

    async updateLastUid(folderId, lastUid) {
      getDb().prepare('UPDATE folders SET last_uid = ? WHERE id = ?').run(lastUid, folderId);
    },

    async clear(folderId) {
      getDb().prepare('DELETE FROM emails WHERE folder_id = ?').run(folderId);
      getDb().prepare('UPDATE folders SET last_uid = 0 WHERE id = ?').run(folderId);
    },
  };
}
