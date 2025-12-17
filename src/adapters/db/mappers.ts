/**
 * Row Mappers (DB -> Domain)
 *
 * Shared mapper functions that convert database rows to domain types.
 * Used by all repository implementations.
 */

import type { Email, Account, Folder, Attachment, Draft, DraftAttachment, RecentContact } from '../../core/domain';
import { getDb } from './connection';

export function mapEmail(row: any): Email {
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

export function mapAccount(row: any): Account {
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

export function mapFolder(row: any): Folder {
  return {
    id: row.id,
    accountId: row.account_id,
    path: row.path,
    name: row.name,
    uidValidity: row.uid_validity,
    lastUid: row.last_uid,
  };
}

export function mapAttachment(row: any): Attachment {
  return {
    id: row.id,
    emailId: row.email_id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    cid: row.cid || undefined,
  };
}

export function mapDraftAttachment(row: any): DraftAttachment {
  return {
    id: row.id,
    draftId: row.draft_id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    content: row.content,
  };
}

export function loadAttachmentsForDraft(draftId: number): DraftAttachment[] {
  const rows = getDb().prepare(
    'SELECT * FROM draft_attachments WHERE draft_id = ?'
  ).all(draftId);
  return rows.map(mapDraftAttachment);
}

export function mapDraft(row: any): Draft {
  return {
    id: row.id,
    accountId: row.account_id,
    to: JSON.parse(row.to_addresses || '[]'),
    cc: JSON.parse(row.cc_addresses || '[]'),
    bcc: JSON.parse(row.bcc_addresses || '[]'),
    subject: row.subject || '',
    text: row.body_text,
    html: row.body_html,
    savedAt: new Date(row.saved_at),
    inReplyTo: row.in_reply_to,
    references: JSON.parse(row.references_list || '[]'),
    originalEmailId: row.original_email_id,
    attachments: loadAttachmentsForDraft(row.id),
  };
}

export function mapContact(row: any): RecentContact {
  const lastUsed = new Date(row.last_used_at);
  const daysSince = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
  const recencyMultiplier = 1 / (1 + daysSince / 30);

  return {
    address: row.address,
    name: row.name,
    useCount: row.use_count,
    lastUsed,
    score: row.use_count * recencyMultiplier,
  };
}
