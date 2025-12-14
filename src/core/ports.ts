/**
 * Ports
 * 
 * Simple function signatures that adapters must implement.
 * This is dependency inversion without the ceremony.
 */

import type { Email, EmailBody, Attachment, Tag, AppliedTag, Account, Folder, ListEmailsOptions, Classification, SyncProgress, SyncOptions } from './domain';

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

export type DraftAttachment = {
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
  attachments?: DraftAttachment[];
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
};

export type ConfigStore = {
  getLLMConfig: () => LLMConfig;
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
  sync: MailSync;
  classifier: Classifier;
  secrets: SecureStorage;
  sender: MailSender;
  config: ConfigStore;
};
