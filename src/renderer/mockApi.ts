/**
 * Mock API for Browser Testing
 *
 * Provides a fake window.mailApi when not running in Electron.
 * Enables UI testing via Chrome DevTools MCP and Storybook.
 */

import type { MailAPI } from '../main/preload';

// Event listeners storage
type Callback = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Callback>>();

// Mock data
const mockAccounts = [
  {
    id: 1,
    name: 'Test Account',
    email: 'test@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    username: 'test@example.com',
    isActive: true,
    lastSyncAt: new Date(),
  },
];

const mockTags = [
  { id: 1, name: 'Work', slug: 'work', color: '#3b82f6', icon: 'briefcase', isSystem: false },
  { id: 2, name: 'Personal', slug: 'personal', color: '#ef4444', icon: 'user', isSystem: false },
  { id: 3, name: 'Finance', slug: 'finance', color: '#22c55e', icon: 'dollar', isSystem: false },
  { id: 4, name: 'Travel', slug: 'travel', color: '#f59e0b', icon: 'plane', isSystem: false },
];

const mockEmails = [
  {
    id: 1,
    messageId: 'msg-001@example.com',
    accountId: 1,
    folderId: 1,
    uid: 1001,
    subject: 'Welcome to Pluribus Mail',
    from: { address: 'hello@pluribus.app', name: 'Pluribus Team' },
    to: ['test@example.com'],
    date: new Date(Date.now() - 1000 * 60 * 30), // 30 min ago
    snippet: 'Thank you for trying Pluribus, the privacy-focused email client with AI-powered organization...',
    sizeBytes: 2500,
    isRead: false,
    isStarred: true,
    hasAttachments: false,
    bodyFetched: true,
  },
  {
    id: 2,
    messageId: 'msg-002@example.com',
    accountId: 1,
    folderId: 1,
    uid: 1002,
    subject: 'Meeting Tomorrow at 3pm',
    from: { address: 'alice@company.com', name: 'Alice Johnson' },
    to: ['test@example.com'],
    date: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    snippet: 'Hi, just wanted to confirm our meeting tomorrow. Please bring the quarterly reports...',
    sizeBytes: 1800,
    isRead: true,
    isStarred: false,
    hasAttachments: true,
    bodyFetched: true,
  },
  {
    id: 3,
    messageId: 'msg-003@example.com',
    accountId: 1,
    folderId: 1,
    uid: 1003,
    subject: 'Your Invoice #12345',
    from: { address: 'billing@service.com', name: 'Billing Department' },
    to: ['test@example.com'],
    date: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    snippet: 'Your invoice for December 2024 is now available. Total amount due: $49.99...',
    sizeBytes: 3200,
    isRead: false,
    isStarred: false,
    hasAttachments: true,
    bodyFetched: false,
  },
  {
    id: 4,
    messageId: 'msg-004@example.com',
    accountId: 1,
    folderId: 1,
    uid: 1004,
    subject: 'Re: Project Update',
    from: { address: 'bob@team.org', name: 'Bob Smith' },
    to: ['test@example.com'],
    date: new Date(Date.now() - 1000 * 60 * 60 * 48), // 2 days ago
    snippet: 'Thanks for the update! I\'ve reviewed the changes and everything looks good to me...',
    sizeBytes: 1200,
    isRead: true,
    isStarred: false,
    hasAttachments: false,
    bodyFetched: true,
  },
  {
    id: 5,
    messageId: 'msg-005@example.com',
    accountId: 1,
    folderId: 1,
    uid: 1005,
    subject: 'Flight Confirmation - Paris',
    from: { address: 'reservations@airline.com', name: 'Airline Bookings' },
    to: ['test@example.com'],
    date: new Date(Date.now() - 1000 * 60 * 60 * 72), // 3 days ago
    snippet: 'Your flight to Paris has been confirmed. Departure: Dec 20, 2024 at 10:30 AM...',
    sizeBytes: 4500,
    isRead: true,
    isStarred: true,
    hasAttachments: true,
    bodyFetched: true,
  },
];

const mockEmailBodies: Record<number, { text: string; html: string }> = {
  1: {
    text: 'Welcome to Pluribus Mail!\n\nThank you for trying Pluribus, the privacy-focused email client with AI-powered organization.\n\nKey features:\n- Smart tagging with local LLM\n- Privacy-first architecture\n- Beautiful, modern interface\n\nBest regards,\nThe Pluribus Team',
    html: '<h1>Welcome to Pluribus Mail!</h1><p>Thank you for trying Pluribus, the privacy-focused email client with AI-powered organization.</p><h2>Key features:</h2><ul><li>Smart tagging with local LLM</li><li>Privacy-first architecture</li><li>Beautiful, modern interface</li></ul><p>Best regards,<br/>The Pluribus Team</p>',
  },
  2: {
    text: 'Hi,\n\nJust wanted to confirm our meeting tomorrow at 3pm.\n\nPlease bring the quarterly reports.\n\nThanks,\nAlice',
    html: '<p>Hi,</p><p>Just wanted to confirm our meeting tomorrow at 3pm.</p><p>Please bring the quarterly reports.</p><p>Thanks,<br/>Alice</p>',
  },
};

// Simulated sync progress
let syncInProgress = false;

export function createMockApi(): MailAPI {
  return {
    emails: {
      list: async () => mockEmails,
      get: async (id) => mockEmails.find((e) => e.id === id) || null,
      getBody: async (id) => mockEmailBodies[id] || { text: 'Email body not available', html: '<p>Email body not available</p>' },
      search: async (query) => mockEmails.filter((e) =>
        e.subject.toLowerCase().includes(query.toLowerCase()) ||
        e.snippet.toLowerCase().includes(query.toLowerCase())
      ),
      markRead: async (id, isRead) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.isRead = isRead;
      },
      star: async (id, isStarred) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.isStarred = isStarred;
      },
      archive: async () => {},
      delete: async () => {},
    },

    attachments: {
      getForEmail: async () => [],
      download: async () => {},
    },

    tags: {
      list: async () => mockTags,
      getForEmail: async (emailId) => {
        // Return some tags for some emails
        if (emailId === 1) return [mockTags[0]]; // Work
        if (emailId === 3) return [mockTags[2]]; // Finance
        if (emailId === 5) return [mockTags[3]]; // Travel
        return [];
      },
      apply: async () => {},
      remove: async () => {},
      create: async (tag) => ({ id: mockTags.length + 1, ...tag }),
    },

    sync: {
      start: async (accountId) => {
        syncInProgress = true;
        // Simulate progress events
        setTimeout(() => {
          listeners.get('sync:progress')?.forEach((cb) =>
            cb({ accountId, folder: 'INBOX', phase: 'fetching', current: 0, total: 10, newCount: 0 })
          );
        }, 100);
        setTimeout(() => {
          listeners.get('sync:progress')?.forEach((cb) =>
            cb({ accountId, folder: 'INBOX', phase: 'storing', current: 5, total: 10, newCount: 3 })
          );
        }, 500);
        setTimeout(() => {
          listeners.get('sync:progress')?.forEach((cb) =>
            cb({ accountId, folder: 'INBOX', phase: 'complete', current: 10, total: 10, newCount: 5 })
          );
          syncInProgress = false;
        }, 1000);
        return { newCount: 5, newEmailIds: [6, 7, 8, 9, 10] };
      },
      startAll: async () => ({ newCount: 5, newEmailIds: [6, 7, 8, 9, 10] }),
      cancel: async () => {
        syncInProgress = false;
        listeners.get('sync:progress')?.forEach((cb) =>
          cb({ accountId: 1, folder: 'INBOX', phase: 'cancelled', current: 0, total: 0, newCount: 0 })
        );
      },
    },

    llm: {
      classify: async () => ({ tags: ['work'], priority: 'normal', confidence: 0.85 }),
      classifyAndApply: async () => ({ tags: ['work'], priority: 'normal', confidence: 0.85, applied: true }),
      getBudget: async () => ({ used: 0.05, limit: 1.0, allowed: true }),
      getEmailBudget: async () => ({ used: 5, limit: 100, allowed: true }),
      validate: async () => ({ valid: true }),
      listModels: async () => [
        { id: 'claude-3-haiku', displayName: 'Claude 3 Haiku' },
        { id: 'llama3.2', displayName: 'Llama 3.2 (Ollama)' },
      ],
      testConnection: async () => ({ connected: true }),
      startOllama: async () => ({ started: true }),
      stopOllama: async () => {},
      isConfigured: async () => ({ configured: true }),
      startBackgroundClassification: async (emailIds) => ({ taskId: 'task-1', count: emailIds.length }),
      getTaskStatus: async () => ({ status: 'completed', processed: 5, total: 5 }),
      clearTask: async () => {},
    },

    aiSort: {
      getPendingReview: async () => [],
      getByPriority: async () => [],
      getFailed: async () => [],
      getStats: async () => ({ total: 0, pending: 0, approved: 0, dismissed: 0, failed: 0 }),
      getPendingCount: async () => 0,
      accept: async () => {},
      dismiss: async () => {},
      retry: async () => {},
      getConfusedPatterns: async () => [],
      clearConfusedPatterns: async () => {},
      getRecentActivity: async () => [],
      bulkAccept: async () => {},
      bulkDismiss: async () => {},
      bulkApplyTag: async () => {},
      classifyUnprocessed: async () => ({ taskId: 'task-1', count: 0 }),
    },

    accounts: {
      list: async () => mockAccounts,
      get: async (id) => mockAccounts.find((a) => a.id === id) || null,
      create: async (account) => ({ id: 2, ...account }),
      add: async (account) => ({
        account: { id: 2, ...account },
        syncResult: { newCount: 0, newEmailIds: [] },
        syncDays: 30,
      }),
      update: async (id, updates) => ({ ...mockAccounts.find((a) => a.id === id), ...updates }),
      delete: async () => {},
      testImap: async () => ({ success: true }),
      testSmtp: async () => ({ success: true }),
    },

    send: {
      email: async () => ({ messageId: 'sent-001', accepted: ['recipient@example.com'], rejected: [] }),
      reply: async () => ({ messageId: 'sent-002', accepted: ['recipient@example.com'], rejected: [] }),
      forward: async () => ({ messageId: 'sent-003', accepted: ['recipient@example.com'], rejected: [] }),
    },

    config: {
      get: async (key) => {
        const defaults: Record<string, unknown> = {
          'llm.provider': 'anthropic',
          'llm.model': 'claude-3-haiku',
          'llm.dailyBudget': 1.0,
          'llm.dailyEmailLimit': 100,
          'llm.autoClassify': false,
          'images.remoteSetting': 'auto',
        };
        return defaults[key];
      },
      set: async () => {},
    },

    credentials: {
      setPassword: async () => {},
      hasPassword: async () => true,
      deletePassword: async () => {},
      setApiKey: async () => {},
      hasApiKey: async () => true,
    },

    security: {
      getConfig: async () => ({
        biometricMode: 'session',
        sessionTimeoutMs: 3600000,
        requireForSend: false,
      }),
      setConfig: async () => {},
      clearSession: async () => {},
      isBiometricAvailable: async () => true,
    },

    images: {
      getSetting: async () => 'auto',
      setSetting: async () => {},
      hasLoaded: async () => false,
      load: async () => [],
      autoLoad: async () => [],
      clearCache: async () => {},
      clearAllCache: async () => {},
    },

    drafts: {
      list: async () => [],
      get: async () => null,
      save: async (draft) => ({ id: 1, ...draft, createdAt: new Date(), updatedAt: new Date() }),
      delete: async () => {},
    },

    contacts: {
      getRecent: async () => [
        { email: 'alice@company.com', name: 'Alice Johnson', useCount: 10, lastUsedAt: new Date() },
        { email: 'bob@team.org', name: 'Bob Smith', useCount: 5, lastUsedAt: new Date() },
      ],
      search: async (query) => [
        { email: 'alice@company.com', name: 'Alice Johnson', useCount: 10, lastUsedAt: new Date() },
      ].filter((c) => c.email.includes(query) || c.name?.toLowerCase().includes(query.toLowerCase())),
    },

    on: (channel, callback) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(callback);
    },

    off: (channel, callback) => {
      listeners.get(channel)?.delete(callback);
    },
  };
}

// Auto-inject mock if not in Electron
export function injectMockApiIfNeeded(): void {
  if (typeof window !== 'undefined' && typeof window.mailApi === 'undefined') {
    console.log('[MockAPI] Injecting mock mailApi for browser testing');
    (window as unknown as { mailApi: MailAPI }).mailApi = createMockApi();
  }
}
