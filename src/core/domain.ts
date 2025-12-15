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

export type NewTagSuggestion = {
  slug: string;
  name: string;
};

export type Classification = {
  suggestedTags: string[];
  confidence: number;
  reasoning: string;
  priority: 'high' | 'normal' | 'low';
  /** Optional new tag suggested by the classifier when no existing tag fits well */
  newTag: NewTagSuggestion | null;
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
  accountId?: number;  // Filter by account for multi-account support
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
  since?: Date;
  folder?: string;
  folders?: string[];
};

// ============================================
// Drafts
// ============================================

export type DraftAttachment = {
  id: number;
  draftId: number;
  filename: string;
  contentType: string | null;
  size: number;
  content: string; // base64 encoded
};

export type DraftAttachmentInput = {
  filename: string;
  contentType?: string;
  size: number;
  content: string; // base64 encoded
};

export type Draft = {
  id: number;
  accountId: number;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  savedAt: Date;
  inReplyTo: string | null;
  references: string[];
  originalEmailId: number | null;
  attachments: DraftAttachment[];
};

export type DraftInput = {
  id?: number;
  accountId: number;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  originalEmailId?: number;
  attachments?: DraftAttachmentInput[];
};

export type ListDraftsOptions = {
  accountId?: number;
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

export function extractSubjectPattern(subject: string): string | null {
  // Detect common patterns that confuse AI
  const patterns = [
    { regex: /^(RE:\s*){2,}/i, pattern: 'RE: RE: RE:*' },  // Multiple replies
    { regex: /^(FW:\s*){2,}/i, pattern: 'FW: FW: FW:*' },  // Multiple forwards
    { regex: /^\[.+?\]\s*/i, pattern: '[list]*' },         // Mailing list prefixes
    { regex: /^(Weekly|Daily|Monthly)\s/i, pattern: 'periodic digest' },
    { regex: /^Digest:/i, pattern: 'digest:*' },
    { regex: /^Newsletter/i, pattern: 'newsletter*' },
  ];

  for (const { regex, pattern } of patterns) {
    if (regex.test(subject)) {
      return pattern;
    }
  }

  return null;
}

export function formatSender(from: { address: string; name: string | null }): string {
  return from.name || from.address;
}

export function isRecent(date: Date, hoursAgo = 24): boolean {
  return Date.now() - date.getTime() < hoursAgo * 60 * 60 * 1000;
}

// ============================================
// Classification State (AI Sort)
// ============================================

export type ClassificationStatus = 'unprocessed' | 'classified' | 'pending_review' | 'accepted' | 'dismissed' | 'error';

export type ClassificationState = {
  emailId: number;
  status: ClassificationStatus;
  confidence: number | null;
  priority: 'high' | 'normal' | 'low' | null;
  suggestedTags: string[];
  reasoning: string | null;
  errorMessage: string | null;
  classifiedAt: Date | null;
  reviewedAt: Date | null;
  dismissedAt: Date | null;
};

export type FeedbackAction = 'accept' | 'accept_edit' | 'dismiss';

export type ClassificationFeedback = {
  id: number;
  emailId: number;
  action: FeedbackAction;
  originalTags: string[];
  finalTags: string[] | null;
  accuracyScore: number;
  createdAt: Date;
};

export type ConfusedPattern = {
  id: number;
  patternType: 'sender_domain' | 'subject_pattern';
  patternValue: string;
  dismissalCount: number;
  avgConfidence: number | null;
  lastSeen: Date;
};

export type ClassificationStats = {
  classifiedToday: number;
  pendingReview: number;
  accuracy30Day: number;
  budgetUsed: number;
  budgetLimit: number;
  priorityBreakdown: {
    high: number;
    normal: number;
    low: number;
  };
};
