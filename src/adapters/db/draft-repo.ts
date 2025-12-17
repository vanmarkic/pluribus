/**
 * Draft Repository
 *
 * Implements DraftRepo port from core/ports.ts using SQLite.
 */

import type { DraftRepo, ListDraftsOptions } from '../../core/ports';
import type { Draft, DraftInput, DraftAttachmentInput } from '../../core/domain';
import { getDb } from './connection';
import { mapDraft } from './mappers';

// ============================================
// Draft Attachment Helpers
// ============================================

function saveAttachmentsForDraft(draftId: number, attachments: DraftAttachmentInput[]): void {
  const insertStmt = getDb().prepare(`
    INSERT INTO draft_attachments (draft_id, filename, content_type, size, content)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const attachment of attachments) {
    insertStmt.run(
      draftId,
      attachment.filename,
      attachment.contentType || null,
      attachment.size,
      attachment.content
    );
  }
}

function deleteAttachmentsForDraft(draftId: number): void {
  getDb().prepare('DELETE FROM draft_attachments WHERE draft_id = ?').run(draftId);
}

// ============================================
// Draft Repository
// ============================================

export function createDraftRepo(): DraftRepo {
  return {
    async findById(id) {
      const row = getDb().prepare('SELECT * FROM drafts WHERE id = ?').get(id);
      return row ? mapDraft(row) : null;
    },

    async list(options: ListDraftsOptions = {}) {
      const { accountId } = options;

      if (accountId) {
        const rows = getDb().prepare(`
          SELECT * FROM drafts WHERE account_id = ? ORDER BY saved_at DESC
        `).all(accountId);
        return rows.map(mapDraft);
      }

      const rows = getDb().prepare(`
        SELECT * FROM drafts ORDER BY saved_at DESC
      `).all();
      return rows.map(mapDraft);
    },

    async save(input) {
      const result = getDb().prepare(`
        INSERT INTO drafts (
          account_id, to_addresses, cc_addresses, bcc_addresses,
          subject, body_text, body_html, in_reply_to, references_list,
          original_email_id, saved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        input.accountId,
        JSON.stringify(input.to || []),
        JSON.stringify(input.cc || []),
        JSON.stringify(input.bcc || []),
        input.subject || '',
        input.text || null,
        input.html || null,
        input.inReplyTo || null,
        JSON.stringify(input.references || []),
        input.originalEmailId || null
      );

      const draftId = result.lastInsertRowid as number;

      // Save attachments if provided
      if (input.attachments && input.attachments.length > 0) {
        saveAttachmentsForDraft(draftId, input.attachments);
      }

      const saved = await this.findById(draftId);
      if (!saved) throw new Error('Failed to save draft');
      return saved;
    },

    async update(id, input) {
      const fields: string[] = ["saved_at = datetime('now')"];
      const values: any[] = [];

      if (input.to !== undefined) { fields.push('to_addresses = ?'); values.push(JSON.stringify(input.to)); }
      if (input.cc !== undefined) { fields.push('cc_addresses = ?'); values.push(JSON.stringify(input.cc)); }
      if (input.bcc !== undefined) { fields.push('bcc_addresses = ?'); values.push(JSON.stringify(input.bcc)); }
      if (input.subject !== undefined) { fields.push('subject = ?'); values.push(input.subject); }
      if (input.text !== undefined) { fields.push('body_text = ?'); values.push(input.text); }
      if (input.html !== undefined) { fields.push('body_html = ?'); values.push(input.html); }
      if (input.inReplyTo !== undefined) { fields.push('in_reply_to = ?'); values.push(input.inReplyTo); }
      if (input.references !== undefined) { fields.push('references_list = ?'); values.push(JSON.stringify(input.references)); }
      if (input.originalEmailId !== undefined) { fields.push('original_email_id = ?'); values.push(input.originalEmailId); }

      values.push(id);
      getDb().prepare(`UPDATE drafts SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      // Handle attachments: if provided, replace all existing attachments
      if (input.attachments !== undefined) {
        deleteAttachmentsForDraft(id);
        if (input.attachments.length > 0) {
          saveAttachmentsForDraft(id, input.attachments);
        }
      }

      const updated = await this.findById(id);
      if (!updated) throw new Error('Draft not found');
      return updated;
    },

    async delete(id) {
      // Attachments are deleted via CASCADE
      getDb().prepare('DELETE FROM drafts WHERE id = ?').run(id);
    },
  };
}
