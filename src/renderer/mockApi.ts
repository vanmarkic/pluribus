/**
 * Mock API for Browser Testing
 *
 * Provides a fake window.mailApi when not running in Electron.
 * Used by Storybook and by the public demo deploy.
 *
 * In demo mode (Vite build), the real classifier reaches Claude via a
 * `/api/classify` Vercel function — every other call stays in-memory.
 */

import type { MailAPI } from '../main/preload';
import { demoFixtures, dripSeeds, type DemoEmail } from './mockApi/fixtures';

// Event listeners storage
type Callback = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Callback>>();
const fire = (channel: string, payload: unknown) => {
  listeners.get(channel)?.forEach((cb) => cb(payload));
};

// Mock data
const mockAccounts = [
  {
    id: 1,
    name: 'Demo Inbox',
    email: 'demo@pluribus.app',
    imapHost: 'imap.example.com',
    imapPort: 993,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    username: 'demo@pluribus.app',
    isActive: true,
    lastSyncAt: new Date(),
  },
];

const mockEmails: DemoEmail[] = [...demoFixtures.emails];
const mockEmailBodies: Record<number, { text: string; html: string }> = { ...demoFixtures.bodies };

/**
 * Live-drip simulator. Every `intervalMs` rotates the next dripSeed into
 * the inbox and fires a `sync:progress` complete event so RTK Query
 * invalidates the list (the renderer listens for this in `App.tsx`).
 */
let dripTimer: ReturnType<typeof setInterval> | null = null;
let dripIndex = 0;
function startLiveDrip(intervalMs = 90_000) {
  if (dripTimer) return;
  dripTimer = setInterval(() => {
    const seed = dripSeeds[dripIndex % dripSeeds.length];
    dripIndex += 1;
    if (!seed) return;
    const id = demoFixtures.nextEmailId();
    const email: DemoEmail = {
      id,
      messageId: `demo-drip-${id}@pluribus.app`,
      accountId: 1,
      folderId: demoFixtures.folderIdFor(seed.folder),
      uid: 5000 + id,
      subject: seed.subject,
      from: { address: seed.fromAddr, name: seed.fromName },
      to: ['demo@pluribus.app'],
      date: new Date(),
      snippet: seed.snippet,
      sizeBytes: 1500 + seed.snippet.length * 8,
      isRead: false,
      isStarred: false,
      hasAttachments: false,
      bodyFetched: false,
      inReplyTo: null,
      references: null,
      threadId: null,
      awaitingReply: false,
      awaitingReplySince: null,
      listUnsubscribe: null,
      listUnsubscribePost: null,
      __folder: seed.folder,
    };
    mockEmails.unshift(email);
    fire('sync:progress', {
      accountId: 1,
      folder: seed.folder,
      phase: 'complete',
      current: 1,
      total: 1,
      newCount: 1,
    });
  }, intervalMs);
}

const stripDemoMeta = (e: DemoEmail) => {
  const { __folder: _f, ...rest } = e;
  return rest;
};

/**
 * Classifier: tries the deploy's `/api/classify` Vercel function first
 * (real Claude call), falls back to a deterministic stub if unreachable.
 */
async function callRealClassifier(emailId: number): Promise<{
  suggestedFolder: string;
  priority: 'high' | 'normal' | 'low';
  confidence: number;
  reasoning: string;
}> {
  const email = mockEmails.find((e) => e.id === emailId);
  const fallback = {
    suggestedFolder: email?.__folder ?? 'INBOX',
    priority: 'normal' as const,
    confidence: 0.7,
    reasoning: 'Stubbed classification — backend unavailable.',
  };
  if (!email) return fallback;
  try {
    const res = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: email.subject,
        from: email.from,
        snippet: email.snippet,
      }),
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as Partial<typeof fallback>;
    return {
      suggestedFolder: json.suggestedFolder ?? fallback.suggestedFolder,
      priority: json.priority ?? fallback.priority,
      confidence: typeof json.confidence === 'number' ? json.confidence : fallback.confidence,
      reasoning: json.reasoning ?? fallback.reasoning,
    };
  } catch {
    return fallback;
  }
}

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
      list: async (options?: {
        starredOnly?: boolean;
        unreadOnly?: boolean;
        folderPath?: string;
        limit?: number;
        offset?: number;
      }) => {
        let filtered: DemoEmail[] = mockEmails;
        if (options?.folderPath) {
          filtered = filtered.filter((e) => e.__folder === options.folderPath);
        } else {
          // Default view: emails not in a long-tail folder.
          filtered = filtered.filter((e) => e.__folder === 'INBOX');
        }
        if (options?.starredOnly) filtered = filtered.filter((e) => e.isStarred);
        if (options?.unreadOnly) filtered = filtered.filter((e) => !e.isRead);
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? 100;
        return filtered.slice(offset, offset + limit).map(stripDemoMeta);
      },
      get: async (id) => {
        const email = mockEmails.find((e) => e.id === id);
        return email ? stripDemoMeta(email) : null;
      },
      getBody: async (id) =>
        mockEmailBodies[id] || {
          text: 'This is a demo email. Real content would render here in the live app.',
          html: '<p style="color:#64748b">This is a demo email. Real content would render here in the live app.</p>',
        },
      search: async (query) =>
        mockEmails
          .filter(
            (e) =>
              e.subject.toLowerCase().includes(query.toLowerCase()) ||
              e.snippet.toLowerCase().includes(query.toLowerCase()),
          )
          .map(stripDemoMeta),
      markRead: async (id, isRead) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.isRead = isRead;
      },
      star: async (id, isStarred) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.isStarred = isStarred;
      },
      archive: async (id: number) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.__folder = 'Archive';
      },
      unarchive: async (id: number) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.__folder = 'INBOX';
      },
      delete: async (id: number) => {
        const idx = mockEmails.findIndex((e) => e.id === id);
        if (idx !== -1) mockEmails.splice(idx, 1);
      },
      trash: async (id: number) => {
        const email = mockEmails.find((e) => e.id === id);
        if (email) email.__folder = 'Trash';
      },
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
      classify: async (emailId: number) => callRealClassifier(emailId) as any,
      classifyAndApply: async (emailId: number) => {
        const result = await callRealClassifier(emailId);
        const email = mockEmails.find((e) => e.id === emailId);
        if (email && result.suggestedFolder) {
          email.__folder = result.suggestedFolder;
          fire('sync:progress', {
            accountId: 1,
            folder: result.suggestedFolder,
            phase: 'complete',
            current: 1,
            total: 1,
            newCount: 0,
          });
        }
        return result as any;
      },
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
      streamExplain: async () => ({ requestId: 'mock' }),
      onStreamEvent: () => () => {},
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
      reclassify: async (emailId: number) => {
        const email = mockEmails.find((e) => e.id === emailId);
        const previousFolder = email?.__folder ?? 'INBOX';
        const result = await callRealClassifier(emailId);
        if (email) email.__folder = result.suggestedFolder;
        return {
          previousFolder,
          previousConfidence: 0.75,
          newFolder: result.suggestedFolder as any,
          newConfidence: result.confidence,
          reasoning: result.reasoning,
        };
      },
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
      getServerUrl: async () => 'http://127.0.0.1:11435',
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
      classify: async (emailId: number) => {
        const r = await callRealClassifier(emailId);
        return { folder: r.suggestedFolder as any, confidence: r.confidence, reasoning: r.reasoning };
      },
      classifyAndMove: async (emailId: number) => {
        const r = await callRealClassifier(emailId);
        const email = mockEmails.find((e) => e.id === emailId);
        if (email) email.__folder = r.suggestedFolder;
        return {
          folder: r.suggestedFolder as any,
          confidence: r.confidence,
          patternAgreed: false,
          reasoning: r.reasoning,
        };
      },
      moveToFolder: async (emailId: number, folder: string) => {
        const email = mockEmails.find((e) => e.id === emailId);
        if (email) email.__folder = folder;
      },
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

    // Email Threading
    threads: {
      list: async () => [],
      messages: async () => [],
    },

    // Awaiting Reply
    awaiting: {
      list: async () => [],
      mark: async () => {},
      clear: async () => {},
      shouldTrack: async () => false,
      clearByReply: async () => null,
      toggle: async () => false,
    },

    // Send Queue (delayed sending)
    sendQueue: {
      queue: async () => ({ id: 'mock-queue-id', expiresAt: new Date(Date.now() + 30000).toISOString() }),
      cancel: async () => true,
      status: async () => null,
    },

    // Unsubscribe
    unsubscribe: {
      parse: async () => ({ mailto: null, https: null, oneClick: false }),
      execute: async () => 'none' as const,
    },

    securityEvents: {
      listRecent: async () => [],
      countByType: async () => ({}),
    },
    bodyMigration: {
      getStatus: async () => ({ total: 0, plaintext: 0, encrypted: 0 }),
      start: async () => ({ taskId: 'mock', total: 0 }),
    },
    calibration: {
      recalibrate: async () => ({ fitSize: 0, eceBefore: 0, eceAfter: 0, fitted: false }),
      getLatest: async () => null,
      getHistory: async () => [],
    },
    embeddings: {
      getStats: async () => ({ totalEmails: 0, indexed: 0, coverage: 0, model: 'all-MiniLM-L6-v2' }),
      backfill: async () => ({ taskId: 'mock', total: 0 }),
    },

    // These two keys extend llm which is already in the surrounding object
    // earlier in the file — the mock API omits them; the typedef allows it
    // via any-cast at the bottom.

    llmCalls: {
      getStats: async () => ({
        totalCalls: 0,
        totalCostUsd: 0,
        todayCalls: 0,
        todayCostUsd: 0,
        monthCostUsd: 0,
        cacheHitRate: 0,
        avgLatencyMs: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
      }),
      listRecent: async () => [],
      getDailyCost: async () => [],
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
    console.log('[MockAPI] Injecting mock mailApi for browser/demo');
    (window as any).mailApi = createMockApi();
    (window as any).__PLURIBUS_DEMO__ = true;
    // Storybook (vite) also injects window.mailApi but we never want a live
    // drip there. Only start when actually running the demo (no IS_STORYBOOK).
    if (!('IS_STORYBOOK' in window)) {
      startLiveDrip();
    }
  }
}
