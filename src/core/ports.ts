/**
 * Ports
 * 
 * Simple function signatures that adapters must implement.
 * This is dependency inversion without the ceremony.
 */

import type { Email, EmailBody, Attachment, Tag, AppliedTag, Account, Folder, ListEmailsOptions, Classification, SyncProgress, SyncOptions, Draft, DraftInput, ListDraftsOptions, ClassificationState, ClassificationFeedback, ConfusedPattern, ClassificationStats, ClassificationStatus } from './domain';

// ============================================
// Email Repository
// ============================================

export type EmailRepo = {
  findById: (id: number) => Promise<Email | null>;
  list: (options: ListEmailsOptions) => Promise<Email[]>;
  search: (query: string, limit?: number) => Promise<Email[]>;
  getBody: (id: number) => Promise<EmailBody | null>;
  saveBody: (id: number, body: EmailBody) => Promise<void>;
  insert: (email: Omit<Email, 'id'>) => Promise<Email>;
  insertBatch: (emails: Omit<Email, 'id'>[]) => Promise<{ count: number; ids: number[] }>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  setStar: (id: number, isStarred: boolean) => Promise<void>;
  delete: (id: number) => Promise<void>;
};

// ============================================
// Attachment Repository
// ============================================

export type AttachmentRepo = {
  findById: (id: number) => Promise<Attachment | null>;
  findByEmailId: (emailId: number) => Promise<Attachment[]>;
  save: (attachment: Omit<Attachment, 'id'> & { content: Buffer }) => Promise<Attachment>;
  getContent: (id: number) => Promise<Buffer | null>;
};

// ============================================
// Tag Repository
// ============================================

export type TagRepo = {
  findAll: () => Promise<Tag[]>;
  findBySlug: (slug: string) => Promise<Tag | null>;
  findByEmailId: (emailId: number) => Promise<AppliedTag[]>;
  apply: (emailId: number, tagId: number, source: string, confidence?: number) => Promise<void>;
  remove: (emailId: number, tagId: number) => Promise<void>;
  create: (tag: Omit<Tag, 'id'>) => Promise<Tag>;
};

// ============================================
// Account Repository
// ============================================

export type AccountInput = {
  name: string;
  email: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  isActive?: boolean;
};

export type AccountRepo = {
  findAll: () => Promise<Account[]>;
  findById: (id: number) => Promise<Account | null>;
  findByEmail: (email: string) => Promise<Account | null>;
  create: (account: AccountInput) => Promise<Account>;
  update: (id: number, account: Partial<AccountInput>) => Promise<Account>;
  delete: (id: number) => Promise<void>;
  updateLastSync: (id: number) => Promise<void>;
};

// ============================================
// Folder Repository
// ============================================

export type FolderRepo = {
  getOrCreate: (accountId: number, path: string, name: string, uidValidity?: number) => Promise<Folder>;
  updateLastUid: (folderId: number, lastUid: number) => Promise<void>;
  clear: (folderId: number) => Promise<void>;
};

// ============================================
// Mail Sync Service
// ============================================

export type SyncResult = {
  newCount: number;
  newEmailIds: number[];
};

export type MailSync = {
  sync: (account: Account, options?: SyncOptions) => Promise<SyncResult>;
  fetchBody: (account: Account, emailId: number) => Promise<EmailBody>;
  disconnect: (accountId: number) => Promise<void>;
  onProgress: (cb: (p: SyncProgress) => void) => () => void;
  testConnection: (host: string, port: number, username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  getDefaultFolders: () => string[];  // Returns folders to sync by default (adapter knows provider-specific names)
};

// ============================================
// Classification Service
// ============================================

export type Classifier = {
  classify: (email: Email, body?: EmailBody, existingTags?: string[]) => Promise<Classification>;
  getBudget: () => { used: number; limit: number; allowed: boolean };
  getEmailBudget: () => { used: number; limit: number; allowed: boolean };
};

// ============================================
// Classification State Repository
// ============================================

export type ClassificationStateRepo = {
  // State management
  getState: (emailId: number) => Promise<ClassificationState | null>;
  setState: (state: Omit<ClassificationState, 'reviewedAt' | 'dismissedAt' | 'errorMessage'> & { reviewedAt?: Date | null; dismissedAt?: Date | null; errorMessage?: string | null }) => Promise<void>;

  // Queries for AI Sort view
  listPendingReview: (options?: { limit?: number; offset?: number; sortBy?: 'confidence' | 'date' | 'sender' }) => Promise<ClassificationState[]>;
  listByPriority: (priority: 'high' | 'normal' | 'low', options?: { limit?: number; offset?: number }) => Promise<ClassificationState[]>;
  listFailed: (options?: { limit?: number; offset?: number }) => Promise<ClassificationState[]>;
  countByStatus: () => Promise<Record<ClassificationStatus, number>>;

  // Re-classification (dismissed emails after cooldown)
  listReclassifiable: (cooldownDays: number) => Promise<number[]>;

  // Feedback logging
  logFeedback: (feedback: Omit<ClassificationFeedback, 'id' | 'createdAt'>) => Promise<void>;
  listRecentFeedback: (limit?: number) => Promise<ClassificationFeedback[]>;

  // Stats & metrics
  getStats: () => Promise<ClassificationStats>;
  getAccuracy30Day: () => Promise<number>;

  // Confused patterns
  listConfusedPatterns: (limit?: number) => Promise<ConfusedPattern[]>;
  updateConfusedPattern: (patternType: 'sender_domain' | 'subject_pattern', patternValue: string, confidence: number) => Promise<void>;
  clearConfusedPatterns: () => Promise<void>;
};

// ============================================
// Secure Storage
// ============================================

export type BiometricMode = 'always' | 'session' | 'lock' | 'never';

export type SecurityConfig = {
  biometricMode: BiometricMode;
  sessionTimeoutMs: number;
  requireForSend: boolean;
};

export type SecureStorage = {
  setPassword: (account: string, password: string) => Promise<void>;
  getPassword: (account: string) => Promise<string | null>;
  deletePassword: (account: string) => Promise<boolean>;
  setApiKey: (service: string, key: string) => Promise<void>;
  getApiKey: (service: string) => Promise<string | null>;
  clearSession: () => void;
  getConfig: () => SecurityConfig;
  setConfig: (config: Partial<SecurityConfig>) => void;
  isBiometricAvailable: () => Promise<boolean>;
};

// ============================================
// Mail Sender (SMTP)
// ============================================

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
};

export type SendAttachment = {
  filename: string;
  content: string; // base64 encoded
  contentType?: string;
};

export type EmailDraft = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: SendAttachment[];
};

export type SendResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
};

export type MailSender = {
  send: (accountEmail: string, smtpConfig: SmtpConfig, draft: EmailDraft) => Promise<SendResult>;
  testConnection: (config: SmtpConfig, email: string) => Promise<{ ok: boolean; error?: string }>;
};

// ============================================
// LLM Config (for classification settings)
// ============================================

export type LLMConfig = {
  model: 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514';
  dailyBudget: number;
  dailyEmailLimit: number;
  autoClassify: boolean;
  confidenceThreshold: number;
  reclassifyCooldownDays: number;
};

export type RemoteImagesSetting = 'block' | 'allow';

export type ConfigStore = {
  getLLMConfig: () => LLMConfig;
  getRemoteImagesSetting: () => RemoteImagesSetting;
  setRemoteImagesSetting: (setting: RemoteImagesSetting) => void;
};

// ============================================
// Image Cache (for remote images)
// ============================================

/**
 * Represents a cached remote image.
 * - url: Original remote URL (https://...)
 * - localPath: Local file:// URL for use in renderer
 */
export type CachedImage = {
  url: string;
  localPath: string;
};

/**
 * Image cache for remote email images.
 *
 * Storage: {userData}/cache/images/{emailId}/{hash}.{ext}
 * Security: Only fetches http/https URLs, validates content-type
 * Cleanup: Call clearCache when email is deleted
 */
export type ImageCache = {
  /** Download and cache images, returns local file:// paths */
  cacheImages: (emailId: number, urls: string[]) => Promise<CachedImage[]>;
  /** Get previously cached images for an email */
  getCachedImages: (emailId: number) => Promise<CachedImage[]>;
  /** Check if user has chosen to load images for this email */
  hasLoadedImages: (emailId: number) => Promise<boolean>;
  /** Mark that user chose to load images (persisted per-email) */
  markImagesLoaded: (emailId: number) => Promise<void>;
  /** Delete cached images for an email (call on email delete) */
  clearCache: (emailId: number) => Promise<void>;
  /** Delete all cached images and reset tracking */
  clearAllCache: () => Promise<void>;
};

// ============================================
// Draft Repository
// ============================================

export type DraftRepo = {
  findById: (id: number) => Promise<Draft | null>;
  list: (options: ListDraftsOptions) => Promise<Draft[]>;
  save: (draft: DraftInput) => Promise<Draft>;
  update: (id: number, draft: Partial<DraftInput>) => Promise<Draft>;
  delete: (id: number) => Promise<void>;
};

// ============================================
// All Dependencies (for DI)
// ============================================

export type Deps = {
  emails: EmailRepo;
  attachments: AttachmentRepo;
  tags: TagRepo;
  accounts: AccountRepo;
  folders: FolderRepo;
  drafts: DraftRepo;
  sync: MailSync;
  classifier: Classifier;
  classificationState: ClassificationStateRepo;
  secrets: SecureStorage;
  sender: MailSender;
  config: ConfigStore;
  imageCache: ImageCache;
};
