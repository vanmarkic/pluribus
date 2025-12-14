/**
 * Core Domain
 * 
 * Pure business types and logic. Zero dependencies.
 * This is the heart of the application.
 */

// ============================================
// Email
// ============================================

export type Email = {
  id: number;
  messageId: string;
  accountId: number;
  folderId: number;
  uid: number;
  subject: string;
  from: { address: string; name: string | null };
  to: string[];
  date: Date;
  snippet: string;
  sizeBytes: number;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  bodyFetched: boolean;
};

export type EmailBody = {
  text: string;
  html: string;
};

export type Attachment = {
  id: number;
  emailId: number;
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
};

// ============================================
// Tags
// ============================================

export type Tag = {
  id: number;
  name: string;
  slug: string;
  color: string;
  isSystem: boolean;
  sortOrder: number;
};

export type TagSource = 'manual' | 'rule' | 'llm';

export type AppliedTag = Tag & {
  source: TagSource;
  confidence: number | null;
};

// ============================================
// Accounts
// ============================================

export type Account = {
  id: number;
  name: string;
  email: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  isActive: boolean;
  lastSync: Date | null;
};

export type Folder = {
  id: number;
  accountId: number;
  path: string;
  name: string;
  uidValidity: number | null;
  lastUid: number;
};

// ============================================
// LLM Classification
// ============================================

export type Classification = {
  suggestedTags: string[];
  confidence: number;
  reasoning: string;
  priority: 'high' | 'normal' | 'low';
};

// ============================================
// Sync
// ============================================

export type SyncPhase = 'connecting' | 'counting' | 'fetching' | 'storing' | 'complete' | 'error';

export type SyncProgress = {
  accountId: number;
  folder: string;
  phase: SyncPhase;
  current: number;
  total: number;
  newCount: number;
  error?: string;
};

// ============================================
// Query Options
// ============================================

export type ListEmailsOptions = {
  tagId?: number;
  folderId?: number;
  folderPath?: string;  // Filter by folder path pattern (e.g., 'Sent' matches 'Sent', 'Sent Items', etc.)
  unreadOnly?: boolean;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
};

export type SyncOptions = {
  headersOnly?: boolean;
  batchSize?: number;
  maxMessages?: number;
  folder?: string;
  folders?: string[];
};

// ============================================
// Business Logic (pure functions)
// ============================================

export function createTagSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function extractDomain(email: string): string {
  return email.split('@')[1] || 'unknown';
}

export function formatSender(from: { address: string; name: string | null }): string {
  return from.name || from.address;
}

export function isRecent(date: Date, hoursAgo = 24): boolean {
  return Date.now() - date.getTime() < hoursAgo * 60 * 60 * 1000;
}
