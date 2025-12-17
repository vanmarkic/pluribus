/**
 * Mock API for Browser Testing
 *
 * Provides a fake window.mailApi when not running in Electron.
 * Enables UI testing via Chrome DevTools MCP and Storybook.
 */

// Import MailAPI type, but allow unarchive to be added even if not in compiled type yet
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

// Tags removed - using folders for organization (Issue #54)

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
    snippet: 'Your invoice for December 2025 is now available. Total amount due: $49.99...',
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
    snippet: 'Your flight to Paris has been confirmed. Departure: Dec 20, 2025 at 10:30 AM...',
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

// Using type assertion to allow extra mock properties not yet in compiled MailAPI
export function createMockApi(): MailAPI {
  // Tags removed - using folders for organization (Issue #54)

  // AI sort pending review items (mutable for accept/dismiss)
  const pendingReviewItems = [
    {
      emailId: 2,
      status: 'pending' as const,
      confidence: 0.78,
      priority: 'normal' as const,
      suggestedFolder: 'Planning' as const,
      reasoning: 'Email discusses a work meeting with quarterly reports',
      errorMessage: null,
      classifiedAt: new Date(),
      reviewedAt: null,
      dismissedAt: null,
      email: mockEmails[1], // Alice Johnson's email
    },
    {
      emailId: 4,
      status: 'pending' as const,
      confidence: 0.65,
      priority: 'low' as const,
      suggestedFolder: 'Review' as const,
      reasoning: 'Project update discussion',
      errorMessage: null,
      classifiedAt: new Date(),
      reviewedAt: null,
      dismissedAt: null,
      email: mockEmails[3], // Bob Smith's email
    },
  ];

  return {
    emails: {
      list: async (options?: { starredOnly?: boolean; folderPath?: string }) => {
        let filtered = mockEmails;

        // Filter by starred
        if (options?.starredOnly) {
          filtered = filtered.filter((e) => e.isStarred);
        }

        return filtered;
      },
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
      archive: async (_id: number) => {},
      unarchive: async (_id: number) => {},
      delete: async (_id: number) => {},
      trash: async (_id: number) => {},
    },

    attachments: {
      getForEmail: async () => [],
      download: async () => {},
    },

    // Tags removed - using folders for organization (Issue #54)

    sync: {
      start: async (accountId) => {
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
        }, 1000);
        return { newCount: 5, newEmailIds: [6, 7, 8, 9, 10] };
      },
      startAll: async () => ({ newCount: 5, newEmailIds: [6, 7, 8, 9, 10] }),
      cancel: async () => {
        listeners.get('sync:progress')?.forEach((cb) =>
          cb({ accountId: 1, folder: 'INBOX', phase: 'cancelled', current: 0, total: 0, newCount: 0 })
        );
      },
    },

    llm: {
      classify: async () => ({ suggestedFolder: 'Planning' as const, priority: 'normal' as const, confidence: 0.85, reasoning: 'Mock classification' }),
      classifyAndApply: async () => ({ suggestedFolder: 'Planning' as const, priority: 'normal' as const, confidence: 0.85, reasoning: 'Mock classification' }),
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
      getPendingReview: async () => pendingReviewItems.filter(item => item.status === 'pending'),
      getByPriority: async () => [],
      getFailed: async () => [],
      getStats: async () => ({
        classifiedToday: 12,
        pendingReview: pendingReviewItems.filter(item => item.status === 'pending').length,
        accuracy30Day: 0.875,
        budgetUsed: 2500,
        budgetLimit: 10000,
        priorityBreakdown: { high: 2, normal: 8, low: 2 },
      }),
      getPendingCount: async () => pendingReviewItems.filter(item => item.status === 'pending').length,
      accept: async (emailId: number, appliedFolder: string) => {
        const item = pendingReviewItems.find(i => i.emailId === emailId);
        if (item) {
          (item as any).status = 'accepted';
          (item as any).reviewedAt = new Date();
          (item as any).suggestedFolder = appliedFolder;
        }
      },
      dismiss: async (emailId) => {
        const item = pendingReviewItems.find(i => i.emailId === emailId);
        if (item) {
          (item as any).status = 'dismissed';
          (item as any).dismissedAt = new Date();
        }
      },
      retry: async () => {},
      getConfusedPatterns: async () => [],
      clearConfusedPatterns: async () => {},
      getRecentActivity: async () => [],
      bulkAccept: async () => {},
      bulkDismiss: async () => {},
      bulkMoveToFolder: async () => {},
      classifyUnprocessed: async () => ({ taskId: 'task-1', count: 0 }),
      // Issue #56: Reclassify email
      reclassify: async (_emailId: number) => ({
        previousFolder: 'INBOX' as const,
        previousConfidence: 0.75,
        newFolder: 'Planning' as const,
        newConfidence: 0.88,
        reasoning: 'Mock reclassification result',
      }),
      getClassificationState: async (emailId: number) => ({
        emailId,
        status: 'classified',
        confidence: 0.85,
        priority: 'normal',
        suggestedFolder: 'INBOX',
        reasoning: 'Mock classification state',
        classifiedAt: new Date().toISOString(),
      }),
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
      getTriageFolders: async () => [
        'INBOX', 'Planning', 'Review', 'Paper-Trail/Invoices', 'Paper-Trail/Admin',
        'Paper-Trail/Travel', 'Feed', 'Social', 'Promotions', 'Archive'
      ],
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

    db: {
      checkIntegrity: async () => ({ isHealthy: true, errors: [] }),
      backup: async () => '/tmp/mock-backup.sqlite',
    },

    ollama: {
      isInstalled: async () => false,
      isRunning: async () => false,
      downloadBinary: async () => {
        // Simulate download progress
        setTimeout(() => {
          listeners.get('ollama:download-progress')?.forEach((cb) =>
            cb({ phase: 'binary', percent: 25, bytesDownloaded: 12500000, totalBytes: 50000000 })
          );
        }, 500);
        setTimeout(() => {
          listeners.get('ollama:download-progress')?.forEach((cb) =>
            cb({ phase: 'binary', percent: 75, bytesDownloaded: 37500000, totalBytes: 50000000 })
          );
        }, 1000);
        setTimeout(() => {
          listeners.get('ollama:download-progress')?.forEach((cb) =>
            cb({ phase: 'binary', percent: 100, bytesDownloaded: 50000000, totalBytes: 50000000 })
          );
        }, 1500);
      },
      start: async () => {},
      stop: async () => {},
      listLocalModels: async () => [],
      pullModel: async (name: string) => {
        // Simulate model download progress
        setTimeout(() => {
          listeners.get('ollama:download-progress')?.forEach((cb) =>
            cb({ phase: 'model', percent: 50, bytesDownloaded: 1000000000, totalBytes: 2000000000, modelName: name })
          );
        }, 500);
        setTimeout(() => {
          listeners.get('ollama:download-progress')?.forEach((cb) =>
            cb({ phase: 'model', percent: 100, bytesDownloaded: 2000000000, totalBytes: 2000000000, modelName: name })
          );
        }, 1000);
      },
      deleteModel: async () => {},
      getRecommendedModels: async () => [
        { id: 'llama3.2:3b', name: 'Llama 3.2', description: 'Best overall accuracy', size: '2.0 GB', sizeBytes: 2000000000 },
        { id: 'mistral:7b', name: 'Mistral 7B', description: 'Excellent for French & European languages', size: '4.1 GB', sizeBytes: 4100000000 },
        { id: 'phi3:mini', name: 'Phi-3 Mini', description: 'Smaller, faster, good for older machines', size: '2.2 GB', sizeBytes: 2200000000 },
      ],
    },

    license: {
      getState: async () => ({
        status: 'inactive' as const,
        licenseKey: null,
        expiresAt: null,
        daysUntilExpiry: null,
        isReadOnly: false,
      }),
      activate: async () => ({
        success: true as const,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      validate: async () => ({
        success: true as const,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      deactivate: async () => {},
    },

    triage: {
      classify: async () => ({ folder: 'INBOX' as const, confidence: 0.9, reasoning: 'Mock classification' }),
      classifyAndMove: async () => ({ folder: 'INBOX' as const, confidence: 0.9, patternAgreed: true, reasoning: 'Mock classification' }),
      moveToFolder: async () => {},
      learnFromCorrection: async () => {},
      snooze: async () => {},
      unsnooze: async () => {},
      processSnoozed: async () => 0,
      saveTrainingExample: async () => {},
      getTrainingExamples: async () => [],
      ensureFolders: async () => ['INBOX', 'Planning', 'Review', 'Feed', 'Social', 'Promotions'],
      getSenderRules: async () => [],
      getLog: async () => [],
      // Issue #55: Select diverse training emails
      selectDiverseTrainingEmails: async () => mockEmails.slice(0, 12),
    },

    on: (channel, callback) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(callback);
    },

    off: (channel, callback) => {
      listeners.get(channel)?.delete(callback);
    },
  } as MailAPI; // Type assertion since source types may differ from compiled
}

// Auto-inject mock if not in Electron
export function injectMockApiIfNeeded(): void {
  if (typeof window !== 'undefined' && typeof window.mailApi === 'undefined') {
    console.log('[MockAPI] Injecting mock mailApi for browser testing');
    (window as any).mailApi = createMockApi();
  }
}
