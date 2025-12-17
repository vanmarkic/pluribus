/**
 * Ports
 * 
 * Simple function signatures that adapters must implement.
 * This is dependency inversion without the ceremony.
 */

import type { Email, EmailBody, Attachment, Account, Folder, ListEmailsOptions, Classification, SyncProgress, SyncOptions, Draft, DraftInput, ListDraftsOptions, ClassificationState, ClassificationFeedback, ConfusedPattern, ClassificationStats, ClassificationStatus, RecentContact, LicenseState, TriageClassificationResult, TrainingExample, SenderRule, EmailSnooze, TriageLogEntry, TriageFolder } from './domain';

// Re-export types needed by adapters
export type { ListEmailsOptions, ListDraftsOptions };

// ============================================
// Email Repository
// ============================================

export type EmailRepo = {
  findById: (id: number) => Promise<Email | null>;
  list: (options: ListEmailsOptions) => Promise<Email[]>;
  search: (query: string, limit?: number, accountId?: number) => Promise<Email[]>;
  getBody: (id: number) => Promise<EmailBody | null>;
  saveBody: (id: number, body: EmailBody) => Promise<void>;
  insert: (email: Omit<Email, 'id'>) => Promise<Email>;
  insertBatch: (emails: Omit<Email, 'id'>[]) => Promise<{ count: number; ids: number[] }>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  setStar: (id: number, isStarred: boolean) => Promise<void>;
  setFolderId: (id: number, folderId: number) => Promise<void>;
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

// Tag Repository removed - using folders for organization (Issue #54)

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
  findById: (id: number) => Promise<Folder | null>;
  getOrCreate: (accountId: number, path: string, name: string, uidValidity?: number) => Promise<Folder>;
  updateLastUid: (folderId: number, lastUid: number) => Promise<void>;
  clear: (folderId: number) => Promise<void>;
};

// ============================================
// Contact Repository
// ============================================

export type ContactRepo = {
  getRecent: (limit?: number) => Promise<RecentContact[]>;
  search: (query: string, limit?: number) => Promise<RecentContact[]>;
  recordUsage: (addresses: string[]) => Promise<void>;
};

// ============================================
// Mail Sync Service
// ============================================

export type SyncResult = {
  newCount: number;
  newEmailIds: number[];
  truncated?: boolean;
  totalAvailable?: number;
  synced?: number;
};

export type MailSync = {
  sync: (account: Account, options?: SyncOptions) => Promise<SyncResult>;
  fetchBody: (account: Account, emailId: number) => Promise<EmailBody>;
  disconnect: (accountId: number) => Promise<void>;
  cancel: (accountId: number) => Promise<void>;
  onProgress: (cb: (p: SyncProgress) => void) => () => void;
  testConnection: (host: string, port: number, username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  getDefaultFolders: (imapHost: string) => string[];  // Returns folders to sync by default based on provider
  listFolders: (account: Account) => Promise<{ path: string; specialUse?: string }[]>;  // List all folders on server
  appendToSent: (account: Account, message: SentMessage) => Promise<void>;  // Append sent email to Sent folder via IMAP
};

// ============================================
// Classification Service
// ============================================

export type Classifier = {
  classify: (email: Email, body?: EmailBody) => Promise<Classification>;
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
  listPendingReview: (options?: { limit?: number; offset?: number; sortBy?: 'confidence' | 'date' | 'sender'; accountId?: number }) => Promise<ClassificationState[]>;
  listByPriority: (priority: 'high' | 'normal' | 'low', options?: { limit?: number; offset?: number; accountId?: number }) => Promise<ClassificationState[]>;
  listFailed: (options?: { limit?: number; offset?: number; accountId?: number }) => Promise<ClassificationState[]>;
  countByStatus: (accountId?: number) => Promise<Record<ClassificationStatus, number>>;

  // Re-classification (dismissed emails after cooldown)
  listReclassifiable: (cooldownDays: number) => Promise<number[]>;

  // Feedback logging
  logFeedback: (feedback: Omit<ClassificationFeedback, 'id' | 'createdAt'>) => Promise<void>;
  listRecentFeedback: (limit?: number, accountId?: number) => Promise<ClassificationFeedback[]>;

  // Stats & metrics
  getStats: (accountId?: number) => Promise<ClassificationStats>;
  getAccuracy30Day: (accountId?: number) => Promise<number>;

  // Confused patterns
  listConfusedPatterns: (limit?: number, accountId?: number) => Promise<ConfusedPattern[]>;
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

// Message to append to Sent folder after SMTP send
export type SentMessage = EmailDraft & {
  from: string;  // Sender email address
};

export type MailSender = {
  send: (accountEmail: string, smtpConfig: SmtpConfig, draft: EmailDraft) => Promise<SendResult>;
  testConnection: (config: SmtpConfig, email: string) => Promise<{ ok: boolean; error?: string }>;
};

// ============================================
// LLM Config (for classification settings)
// ============================================

export type LLMConfig = {
  provider: LLMProviderType;
  model: string;
  dailyBudget: number;
  dailyEmailLimit: number;
  autoClassify: boolean;
  confidenceThreshold: number;
  reclassifyCooldownDays: number;
  // Ollama-specific
  ollamaServerUrl?: string;
  // Parallelism for local models (Ollama) - default 1 for Anthropic (rate limited)
  classificationConcurrency?: number;
};

// ============================================
// LLM Provider (for model listing & validation)
// ============================================

export type LLMModel = {
  id: string;
  displayName: string;
  createdAt?: string;
};

export type LLMProviderType = 'anthropic' | 'ollama';

export type LLMProvider = {
  type: LLMProviderType;
  validateKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
  listModels: () => Promise<LLMModel[]>;
  testConnection?: () => Promise<{ connected: boolean; error?: string }>;
};

export type RemoteImagesSetting = 'block' | 'allow' | 'auto';

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
  /** Delete only filesystem cache files for an email (DB cascade handles email_images_loaded) */
  clearCacheFiles: (emailId: number) => Promise<void>;
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
// Background Task Manager
// ============================================

export type TaskStatus = 'running' | 'completed' | 'failed';

export type TaskState = {
  status: TaskStatus;
  processed: number;
  total: number;
  error?: string;
};

export type BackgroundTaskManager = {
  start: (id: string, total: number, fn: (onProgress: () => void) => Promise<void>) => void;
  getStatus: (id: string) => TaskState | null;
  clear: (id: string) => void;
};

// ============================================
// Database Health & Recovery
// ============================================

export type IntegrityCheckResult = {
  isHealthy: boolean;
  errors: string[];
};

export type DatabaseHealth = {
  checkIntegrity: (full?: boolean) => Promise<IntegrityCheckResult>;
  createBackup: () => Promise<string>;
};

// ============================================
// License Service
// ============================================

export type ActivationResult =
  | { success: true; expiresAt: Date }
  | { success: true; warning: 'device_changed'; message: string; expiresAt: Date }
  | { success: false; error: string };

export type LicenseService = {
  /** Get current license state (cached, call frequently) */
  getState: () => LicenseState;
  /** Activate a license key (calls server) */
  activate: (licenseKey: string) => Promise<ActivationResult>;
  /** Validate with server (updates local cache) */
  validate: () => Promise<ActivationResult>;
  /** Clear local license data */
  deactivate: () => Promise<void>;
  /** Subscribe to license state changes */
  onStateChange: (cb: (state: LicenseState) => void) => () => void;
};

// ============================================
// Email Triage Ports
// ============================================

export type TriageConfig = {
  enabled: boolean;
  confidenceThreshold: number;
  waitingReplyDays: number;
  twoFaAutoDeleteMinutes: number;
  promoAutoArchiveDays: number;
  devAutoDeleteDays: number;
};

export type PatternMatchResult = {
  folder: TriageFolder;
  confidence: number;
  tags: string[];
  snoozeUntil?: Date;
  autoDeleteAfter?: number;
};

export type PatternMatcher = {
  match: (email: Email) => PatternMatchResult;
};

export type TriageClassifier = {
  classify: (email: Email, patternHint: PatternMatchResult, examples: TrainingExample[]) => Promise<TriageClassificationResult>;
};

export type TrainingRepo = {
  findByAccount: (accountId: number, limit?: number) => Promise<TrainingExample[]>;
  findByDomain: (accountId: number, domain: string, limit?: number) => Promise<TrainingExample[]>;
  save: (example: Omit<TrainingExample, 'id' | 'createdAt'>) => Promise<TrainingExample>;
  getRelevantExamples: (accountId: number, email: Email, limit?: number) => Promise<TrainingExample[]>;
};

export type SenderRuleRepo = {
  findByAccount: (accountId: number) => Promise<SenderRule[]>;
  findAutoApply: (accountId: number) => Promise<SenderRule[]>;
  findByPattern: (accountId: number, pattern: string, patternType: string) => Promise<SenderRule | null>;
  upsert: (rule: Omit<SenderRule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SenderRule>;
  incrementCount: (id: number) => Promise<void>;
};

export type SnoozeRepo = {
  findByEmail: (emailId: number) => Promise<EmailSnooze | null>;
  findDue: () => Promise<EmailSnooze[]>;
  create: (snooze: Omit<EmailSnooze, 'id' | 'createdAt'>) => Promise<EmailSnooze>;
  delete: (emailId: number) => Promise<void>;
};

export type TriageLogRepo = {
  log: (entry: Omit<TriageLogEntry, 'id' | 'createdAt'>) => Promise<void>;
  findByEmail: (emailId: number) => Promise<TriageLogEntry[]>;
  findRecent: (limit?: number, accountId?: number) => Promise<TriageLogEntry[]>;
};

export type ImapFolderOps = {
  createFolder: (account: Account, path: string) => Promise<void>;
  deleteFolder: (account: Account, path: string) => Promise<void>;
  listFolders: (account: Account) => Promise<{ path: string; specialUse?: string }[]>;
  moveMessage: (account: Account, emailUid: number, fromFolder: string, toFolder: string) => Promise<void>;
  moveToTrash: (account: Account, emailUid: number, fromFolder: string) => Promise<string>;
  ensureTriageFolders: (account: Account) => Promise<string[]>;
};

export type EmailTriageService = {
  classifyEmail: (email: Email) => Promise<TriageClassificationResult>;
  moveToFolder: (emailId: number, folder: TriageFolder) => Promise<void>;
  scheduleSnooze: (emailId: number, until: Date, reason: EmailSnooze['reason']) => Promise<void>;
  cancelSnooze: (emailId: number) => Promise<void>;
  processSnoozedEmails: () => Promise<number>;
  learnFromCorrection: (emailId: number, fromFolder: string, toFolder: TriageFolder) => Promise<void>;
};

// ============================================
// All Dependencies (for DI)
// ============================================

export type Deps = {
  emails: EmailRepo;
  attachments: AttachmentRepo;
  accounts: AccountRepo;
  folders: FolderRepo;
  drafts: DraftRepo;
  contacts: ContactRepo;
  sync: MailSync;
  classifier: Classifier;
  classificationState: ClassificationStateRepo;
  secrets: SecureStorage;
  sender: MailSender;
  config: ConfigStore;
  imageCache: ImageCache;
  llmProvider: LLMProvider;
  backgroundTasks: BackgroundTaskManager;
  databaseHealth: DatabaseHealth;
  license: LicenseService;
  // Triage
  patternMatcher: PatternMatcher;
  triageClassifier: TriageClassifier;
  trainingRepo: TrainingRepo;
  senderRules: SenderRuleRepo;
  snoozes: SnoozeRepo;
  triageLog: TriageLogRepo;
  imapFolderOps: ImapFolderOps;
};
