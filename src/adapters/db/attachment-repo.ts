/**
 * Attachment Repository
 *
 * Implements AttachmentRepo port from core/ports.ts using SQLite.
 */

import type { AttachmentRepo } from '../../core/ports';
import type { Attachment } from '../../core/domain';
import { getDb } from './connection';
import { mapAttachment } from './mappers';

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
