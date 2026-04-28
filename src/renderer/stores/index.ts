/**
 * Renderer state.
 *
 * Server data (emails) → RTK Query (`emailsApi`).
 * UI state (selection/focus/filter) → `useEmailUiStore`.
 * Other domain state (accounts, sync, view, license) → Zustand stores below.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Email, EmailBody, Attachment, Account, SyncProgress, Draft, DraftInput, ClassificationStats, ClassificationFeedback, ConfusedPattern, ClassificationState, RecentContact } from '../../core/domain';

export { useEmailUiStore } from './emailUiStore';
export type { EmailFilter } from './emailUiStore';
export {
  emailsApi,
  invalidateEmailList,
  useListEmailsQuery,
  useGetEmailQuery,
  useGetEmailBodyQuery,
  useGetEmailAttachmentsQuery,
  useMarkReadMutation,
  useSetStarredMutation,
  useArchiveEmailMutation,
  useUnarchiveEmailMutation,
  useTrashEmailMutation,
  useBulkMarkReadMutation,
  useBulkArchiveMutation,
  useBulkTrashMutation,
  useDownloadAttachmentMutation,
} from './emailsApi';
export type { ListEmailsArg } from './emailsApi';
export { store } from './store';

// Type for review queue items - matches backend PendingReviewItem
// ClassificationState fields at top level, email nested
type ReviewItem = ClassificationState & { email: Email };

// ============================================
// Types for window.mailApi
// ============================================

declare global {
  interface Window {
    mailApi: {
      emails: {
        list: (opts?: any) => Promise<Email[]>;
        get: (id: number) => Promise<Email | null>;
        getBody: (id: number) => Promise<EmailBody>;
        search: (query: string, limit?: number, accountId?: number) => Promise<Email[]>;
        markRead: (id: number, isRead: boolean) => Promise<void>;
        star: (id: number, isStarred: boolean) => Promise<void>;
        archive: (id: number) => Promise<void>;
        unarchive: (id: number) => Promise<void>;
        delete: (id: number) => Promise<void>;
        trash: (id: number) => Promise<void>;
      };
      attachments: {
        getForEmail: (emailId: number) => Promise<Attachment[]>;
        download: (attachmentId: number, action?: 'open' | 'save') => Promise<{ path: string; action: string }>;
      };
      // Tags removed - using folders for organization (Issue #54)
      accounts: {
        list: () => Promise<Account[]>;
        get: (id: number) => Promise<Account | null>;
        testImap: (email: string, host: string, port: number) => Promise<{ ok: boolean; error?: string }>;
        testSmtp: (email: string, host: string, port: number) => Promise<{ ok: boolean; error?: string }>;
        create: (account: any, password: string) => Promise<Account>;
        add: (account: any, password: string, options?: { skipSync?: boolean }) => Promise<{
          account: Account;
          syncResult: { newCount: number; newEmailIds: number[] };
          syncDays: number;
        }>;
        update: (id: number, updates: any, newPassword?: string) => Promise<Account>;
        delete: (id: number) => Promise<void>;
      };
      credentials: {
        setPassword: (account: string, password: string) => Promise<void>;
        hasPassword: (account: string) => Promise<boolean>;
        deletePassword: (account: string) => Promise<boolean>;
        setApiKey: (service: string, key: string) => Promise<void>;
        hasApiKey: (service: string) => Promise<boolean>;
      };
      send: {
        email: (accountId: number, draft: any) => Promise<{ messageId: string }>;
      };
      sync: {
        start: (accountId: number, opts?: any) => Promise<{ newCount: number; newEmailIds: number[]; truncated?: boolean; totalAvailable?: number; synced?: number }>;
        startAll: (opts?: any) => Promise<{ newCount: number; newEmailIds: number[]; truncated?: boolean; totalAvailable?: number; synced?: number }>;
        cancel: (accountId: number) => Promise<void>;
      };
      llm: {
        classify: (emailId: number) => Promise<any>;
        classifyAndApply: (emailId: number) => Promise<any>;
        getBudget: () => Promise<{ used: number; limit: number; allowed: boolean }>;
        getEmailBudget: () => Promise<{ used: number; limit: number; allowed: boolean }>;
        validate: (key?: string) => Promise<{ valid: boolean; error?: string }>;
        listModels: () => Promise<{ id: string; displayName: string; createdAt?: string }[]>;
        testConnection: () => Promise<{ connected: boolean; error?: string }>;
        startOllama: () => Promise<{ started: boolean; error?: string }>;
        stopOllama: () => Promise<void>;
        isConfigured: () => Promise<{ configured: boolean; reason?: string }>;
        startBackgroundClassification: (emailIds: number[]) => Promise<{ taskId: string; count: number }>;
        getTaskStatus: (taskId: string) => Promise<{ status: 'running' | 'completed' | 'failed'; processed: number; total: number; error?: string } | null>;
        clearTask: (taskId: string) => Promise<void>;
        streamExplain: (emailId: number) => Promise<{ requestId: string }>;
        onStreamEvent: (
          requestId: string,
          callback: (event:
            | { type: 'text'; delta: string }
            | { type: 'done'; fullText: string }
            | { type: 'error'; message: string }
          ) => void,
        ) => () => void;
      };
      config: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
        getTriageFolders: () => Promise<string[]>;
      };
      security: {
        getConfig: () => Promise<any>;
        setConfig: (updates: any) => Promise<void>;
        clearSession: () => Promise<void>;
        isBiometricAvailable: () => Promise<boolean>;
      };
      images: {
        getSetting: () => Promise<'block' | 'allow' | 'auto'>;
        setSetting: (setting: 'block' | 'allow' | 'auto') => Promise<void>;
        hasLoaded: (emailId: number) => Promise<boolean>;
        load: (emailId: number, urls: string[]) => Promise<{ url: string; localPath: string }[]>;
        autoLoad: (emailId: number, urls: string[]) => Promise<{ url: string; localPath: string }[]>;
        clearCache: (emailId: number) => Promise<void>;
        clearAllCache: () => Promise<void>;
      };
      drafts: {
        list: (opts?: { accountId?: number }) => Promise<Draft[]>;
        get: (id: number) => Promise<Draft | null>;
        save: (draft: DraftInput) => Promise<Draft>;
        delete: (id: number) => Promise<void>;
      };
      aiSort: {
        getStats: (accountId?: number) => Promise<ClassificationStats>;
        getPendingReview: (opts?: { sortBy?: string; limit?: number; accountId?: number }) => Promise<ReviewItem[]>;
        // Updated for folder-based classification (Issue #54)
        accept: (emailId: number, appliedFolder: string) => Promise<void>;
        dismiss: (emailId: number) => Promise<void>;
        bulkAccept: (emailIds: number[]) => Promise<void>;
        bulkDismiss: (emailIds: number[]) => Promise<void>;
        getConfusedPatterns: (limit?: number, accountId?: number) => Promise<ConfusedPattern[]>;
        getRecentActivity: (limit?: number, accountId?: number) => Promise<ClassificationFeedback[]>;
        classifyUnprocessed: () => Promise<{ classified: number; skipped: number }>;
        clearConfusedPatterns: () => Promise<void>;
        // Issue #56: Reclassify email
        reclassify: (emailId: number) => Promise<{
          previousFolder: string | null;
          previousConfidence: number | null;
          newFolder: string;
          newConfidence: number;
          reasoning: string;
        }>;
        getClassificationState: (emailId: number) => Promise<{
          emailId: number;
          status: string;
          confidence: number | null;
          priority: string | null;
          suggestedFolder: string | null;
          reasoning: string | null;
          classifiedAt: string | null;
        } | null>;
      };
      contacts: {
        getRecent: (limit?: number) => Promise<RecentContact[]>;
        search: (query: string, limit?: number) => Promise<RecentContact[]>;
      };
      securityEvents: {
        listRecent: (opts?: {
          limit?: number;
          eventType?: string;
          severity?: 'info' | 'warn' | 'alert';
          sinceTs?: string;
        }) => Promise<Array<{
          id: number;
          ts: string;
          eventType: string;
          severity: 'info' | 'warn' | 'alert';
          actor: string;
          target: string | null;
          success: boolean;
          metadata: Record<string, unknown>;
        }>>;
        countByType: (sinceTs?: string) => Promise<Record<string, number>>;
      };
      bodyMigration: {
        getStatus: () => Promise<{ total: number; plaintext: number; encrypted: number }>;
        start: () => Promise<{ taskId: string; total: number }>;
      };
      calibration: {
        recalibrate: (opts?: { minSamples?: number }) => Promise<{
          fitSize: number;
          eceBefore: number;
          eceAfter: number;
          fitted: boolean;
        }>;
        getLatest: () => Promise<{
          id: number;
          fitAt: string;
          a: number;
          b: number;
          fitSize: number;
          eceBefore: number | null;
          eceAfter: number | null;
        } | null>;
        getHistory: (limit?: number) => Promise<Array<{
          id: number;
          fitAt: string;
          a: number;
          b: number;
          fitSize: number;
          eceBefore: number | null;
          eceAfter: number | null;
        }>>;
      };
      embeddings: {
        getStats: () => Promise<{
          totalEmails: number;
          indexed: number;
          coverage: number;
          model: string;
        }>;
        backfill: (opts?: { limit?: number; accountId?: number }) => Promise<{ taskId: string; total: number }>;
      };
      llmCalls: {
        getStats: () => Promise<{
          totalCalls: number;
          totalCostUsd: number;
          todayCalls: number;
          todayCostUsd: number;
          monthCostUsd: number;
          cacheHitRate: number;
          avgLatencyMs: number;
          totalInputTokens: number;
          totalOutputTokens: number;
          totalCacheReadTokens: number;
          totalCacheCreationTokens: number;
        }>;
        listRecent: (limit?: number) => Promise<Array<{
          id: number;
          ts: string;
          provider: string;
          model: string;
          emailId: number | null;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
          latencyMs: number;
          costUsd: number;
          cacheHit: boolean;
          stopReason: string | null;
          error: string | null;
        }>>;
        getDailyCost: (days?: number) => Promise<Array<{
          day: string;
          model: string;
          calls: number;
          costUsd: number;
        }>>;
      };
      db: {
        checkIntegrity: (full?: boolean) => Promise<{ isHealthy: boolean; errors: string[] }>;
        backup: () => Promise<string>;
      };
      ollama: {
        isInstalled: () => Promise<boolean>;
        isRunning: () => Promise<boolean>;
        downloadBinary: () => Promise<void>;
        start: () => Promise<void>;
        stop: () => Promise<void>;
        listLocalModels: () => Promise<{ name: string; size: number; modifiedAt: string }[]>;
        pullModel: (name: string) => Promise<void>;
        deleteModel: (name: string) => Promise<void>;
        getRecommendedModels: () => Promise<{
          id: string;
          name: string;
          description: string;
          size: string;
          sizeBytes: number;
        }[]>;
        getServerUrl: () => Promise<string>;
      };
      license: {
        getState: () => Promise<{
          status: 'active' | 'expired' | 'grace' | 'inactive';
          licenseKey: string | null;
          expiresAt: string | null;
          daysUntilExpiry: number | null;
          isReadOnly: boolean;
        }>;
        activate: (licenseKey: string) => Promise<
          | { success: true; expiresAt: string }
          | { success: true; warning: 'device_changed'; message: string; expiresAt: string }
          | { success: false; error: string }
        >;
        validate: () => Promise<
          | { success: true; expiresAt: string }
          | { success: false; error: string }
        >;
        deactivate: () => Promise<void>;
      };
      triage: {
        classify: (emailId: number) => Promise<any>;
        moveToFolder: (emailId: number, folder: string, accountId: number) => Promise<void>;
        learnFromCorrection: (emailId: number, oldFolder: string, newFolder: string, accountId: number) => Promise<void>;
        snooze: (emailId: number, accountId: number, until: string) => Promise<any>;
        unsnooze: (emailId: number) => Promise<void>;
        processSnoozed: () => Promise<number[]>;
        saveTrainingExample: (example: any) => Promise<any>;
        getTrainingExamples: (accountId: number, limit?: number) => Promise<any[]>;
        ensureFolders: (accountId: number) => Promise<string[]>;
        getSenderRules: (accountId: number) => Promise<any[]>;
        getLog: (emailId: number) => Promise<any[]>;
        // Issue #55: Select diverse training emails
        selectDiverseTrainingEmails: (accountId: number, options?: { maxEmails?: number; poolSize?: number }) => Promise<Email[]>;
      };
      // Threading
      threads: {
        list: (accountId: number, folderId: number) => Promise<{
          threadId: string;
          subject: string;
          snippet: string;
          participants: { address: string; name: string | null }[];
          messageCount: number;
          unreadCount: number;
          latestDate: string;
          isLatestUnread: boolean;
        }[]>;
        messages: (threadId: string) => Promise<Email[]>;
      };
      // Awaiting Reply
      awaiting: {
        list: (accountId: number) => Promise<Email[]>;
        mark: (emailId: number) => Promise<void>;
        clear: (emailId: number) => Promise<void>;
        shouldTrack: (body: string) => Promise<boolean>;
        clearByReply: (inReplyToMessageId: string) => Promise<number | null>;
        toggle: (emailId: number) => Promise<boolean>;
      };
      // Send Queue (undo send)
      sendQueue: {
        queue: (accountId: number, draft: any) => Promise<{ id: string; expiresAt: string }>;
        cancel: (id: string) => Promise<boolean>;
        status: (id: string) => Promise<{
          id: string;
          accountId: number;
          draft: any;
          expiresAt: string;
          status: 'pending' | 'sent' | 'cancelled';
        } | null>;
      };
      // Unsubscribe
      unsubscribe: {
        parse: (listUnsubscribe: string | null, listUnsubscribePost?: string) => Promise<{
          mailto: string | null;
          https: string | null;
          oneClick: boolean;
        }>;
        execute: (info: { mailto: string | null; https: string | null; oneClick: boolean }) => Promise<'email' | 'post' | 'browser' | 'none'>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}


// ============================================
// Tag Store removed - using folders for organization (Issue #54)
// ============================================

// ============================================
// Sync Store
// ============================================

type SyncStore = {
  syncing: boolean;
  syncingAccountId: number | null;
  progress: SyncProgress | null;
  lastSync: Date | null;
  lastError: string | null;
  truncationInfo: {
    truncated: boolean;
    totalAvailable: number;
    synced: number;
  } | null;

  startSync: (accountId: number) => Promise<void>;
  startSyncAll: () => Promise<void>;
  cancelSync: (accountId: number) => Promise<void>;
  setProgress: (progress: SyncProgress | null) => void;
  dismissTruncationInfo: () => void;
};

export const useSyncStore = create<SyncStore>((set, get) => ({
  syncing: false,
  syncingAccountId: null,
  progress: null,
  lastSync: null,
  lastError: null,
  truncationInfo: null,

  // Sync specified account - caller provides accountId (no cross-store coupling)
  startSync: async (accountId: number) => {
    set({ syncing: true, syncingAccountId: accountId, lastError: null, truncationInfo: null });
    try {
      const result = await window.mailApi.sync.start(accountId);
      set({ lastSync: new Date() });

      // Store truncation info if sync was truncated
      if (result && typeof result === 'object' && 'truncated' in result && result.truncated) {
        set({
          truncationInfo: {
            truncated: result.truncated,
            totalAvailable: result.totalAvailable || 0,
            synced: result.synced || 0,
          }
        });
      }
      // Note: Caller should reload emails after sync completes
    } catch (err) {
      set({ lastError: String(err) });
    } finally {
      set({ syncing: false, syncingAccountId: null, progress: null });
    }
  },

  // Sync all accounts
  startSyncAll: async () => {
    set({ syncing: true, syncingAccountId: null, lastError: null, truncationInfo: null });
    try {
      const result = await window.mailApi.sync.startAll();
      set({ lastSync: new Date() });

      // Store truncation info if sync was truncated
      if (result && typeof result === 'object' && 'truncated' in result && result.truncated) {
        set({
          truncationInfo: {
            truncated: result.truncated,
            totalAvailable: result.totalAvailable || 0,
            synced: result.synced || 0,
          }
        });
      }
      // Note: Caller should reload emails after sync completes
    } finally {
      set({ syncing: false, progress: null });
    }
  },

  cancelSync: async (accountId: number) => {
    try {
      await window.mailApi.sync.cancel(accountId);
    } finally {
      // Only clear state if we're still syncing this account
      // (prevents race condition if another sync started during cancel)
      if (get().syncingAccountId === accountId) {
        set({ syncing: false, syncingAccountId: null, progress: null });
      }
    }
  },

  setProgress: (progress) => set({ progress }),

  dismissTruncationInfo: () => set({ truncationInfo: null }),
}));

// ============================================
// Account Store
// ============================================

type AccountStore = {
  accounts: Account[];
  selectedAccountId: number | null;
  loading: boolean;

  loadAccounts: () => Promise<void>;
  selectAccount: (id: number) => void;
  getSelectedAccount: () => Account | null;
};

export const useAccountStore = create<AccountStore>()(
  persist(
    (set, get) => ({
      accounts: [],
      selectedAccountId: null,
      loading: false,

      loadAccounts: async () => {
        set({ loading: true });
        const accounts = await window.mailApi.accounts.list();
        set({ accounts, loading: false });

        // Auto-select first account if none selected or selected account no longer exists
        const { selectedAccountId } = get();
        const accountExists = accounts.some(a => a.id === selectedAccountId);
        const firstAccount = accounts[0];
        if ((!selectedAccountId || !accountExists) && firstAccount) {
          set({ selectedAccountId: firstAccount.id });
        }
      },

      selectAccount: (id) => {
        set({ selectedAccountId: id });
        // Note: Components should react to selectedAccountId changes via useEffect
        // and call loadEmails() - this avoids cross-store coupling
      },

      getSelectedAccount: () => {
        const { accounts, selectedAccountId } = get();
        return accounts.find(a => a.id === selectedAccountId) || null;
      },
    }),
    {
      name: 'account-store',
      partialize: (state) => ({ selectedAccountId: state.selectedAccountId }),
    }
  )
);

// ============================================
// UI Store
// ============================================

type View = 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'drafts' | 'settings' | 'ai-sort'
  | 'planning' | 'review' | 'feed' | 'social' | 'promotions' | 'awaiting'
  | 'paper-trail/invoices' | 'paper-trail/admin' | 'paper-trail/travel';
type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | null;

type UIStore = {
  view: View;
  sidebarCollapsed: boolean;

  // Modal states
  showAccountWizard: boolean;
  editAccountId: number | null;
  composeMode: ComposeMode;
  composeEmailId: number | null;
  composeDraftId: number | null;

  // Classification progress
  classificationTaskId: string | null;
  classificationProgress: { processed: number; total: number } | null;

  setView: (view: View) => void;
  toggleSidebar: () => void;

  // Account wizard
  openAccountWizard: (editId?: number) => void;
  closeAccountWizard: () => void;

  // Compose
  openCompose: (mode: ComposeMode, emailId?: number) => void;
  openComposeDraft: (draftId: number) => void;
  closeCompose: () => void;

  // Classification
  setClassificationTask: (taskId: string, total: number) => void;
  updateClassificationProgress: (processed: number, total: number) => void;
  clearClassificationTask: () => void;
};

export const useUIStore = create<UIStore>((set) => ({
  view: 'inbox',
  sidebarCollapsed: false,
  showAccountWizard: false,
  editAccountId: null,
  composeMode: null,
  composeEmailId: null,
  composeDraftId: null,
  classificationTaskId: null,
  classificationProgress: null,

  setView: (view) => set({ view }),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  openAccountWizard: (editId) => set({ showAccountWizard: true, editAccountId: editId ?? null }),
  closeAccountWizard: () => set({ showAccountWizard: false, editAccountId: null }),

  openCompose: (mode, emailId) => set({ composeMode: mode, composeEmailId: emailId ?? null, composeDraftId: null }),
  openComposeDraft: (draftId) => set({ composeMode: 'new', composeEmailId: null, composeDraftId: draftId }),
  closeCompose: () => set({ composeMode: null, composeEmailId: null, composeDraftId: null }),

  setClassificationTask: (taskId, total) => set({ classificationTaskId: taskId, classificationProgress: { processed: 0, total } }),
  updateClassificationProgress: (processed, total) => set({ classificationProgress: { processed, total } }),
  clearClassificationTask: () => set({ classificationTaskId: null, classificationProgress: null }),
}));

// ============================================
// License Store
// ============================================

type LicenseStatus = 'active' | 'expired' | 'grace' | 'inactive';

type LicenseStore = {
  status: LicenseStatus;
  licenseKey: string | null;
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
  isReadOnly: boolean;
  loading: boolean;
  error: string | null;
  showActivationModal: boolean;

  // Actions
  loadState: () => Promise<void>;
  activate: (licenseKey: string) => Promise<{ success: boolean; warning?: string; error?: string }>;
  deactivate: () => Promise<void>;
  openActivationModal: () => void;
  closeActivationModal: () => void;
};

export const useLicenseStore = create<LicenseStore>((set, get) => ({
  status: 'inactive',
  licenseKey: null,
  expiresAt: null,
  daysUntilExpiry: null,
  isReadOnly: false,
  loading: false,
  error: null,
  showActivationModal: false,

  loadState: async () => {
    try {
      const state = await window.mailApi.license.getState();
      set({
        status: state.status,
        licenseKey: state.licenseKey,
        expiresAt: state.expiresAt ? new Date(state.expiresAt) : null,
        daysUntilExpiry: state.daysUntilExpiry,
        isReadOnly: state.isReadOnly,
        error: null,
      });
    } catch (err) {
      console.error('Failed to load license state:', err);
    }
  },

  activate: async (licenseKey) => {
    set({ loading: true, error: null });
    try {
      const result = await window.mailApi.license.activate(licenseKey);
      if (result.success) {
        await get().loadState();
        set({ loading: false, showActivationModal: false });
        if ('warning' in result) {
          return { success: true, warning: result.message };
        }
        return { success: true };
      } else {
        set({ loading: false, error: result.error });
        return { success: false, error: result.error };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      set({ loading: false, error });
      return { success: false, error };
    }
  },

  deactivate: async () => {
    set({ loading: true });
    try {
      await window.mailApi.license.deactivate();
      await get().loadState();
      set({ loading: false });
    } catch (err) {
      console.error('Failed to deactivate license:', err);
      set({ loading: false });
    }
  },

  openActivationModal: () => set({ showActivationModal: true, error: null }),
  closeActivationModal: () => set({ showActivationModal: false, error: null }),
}));

// ============================================
// Thread Store
// ============================================

type ThreadStore = {
  // State
  threadView: boolean;           // true = show threaded, false = flat
  expandedThreads: Set<string>;  // Set of expanded thread IDs

  // Actions
  setThreadView: (enabled: boolean) => void;
  toggleThread: (threadId: string) => void;
  expandThread: (threadId: string) => void;
  collapseThread: (threadId: string) => void;
  collapseAll: () => void;
  expandAll: (threadIds: string[]) => void;
};

export const useThreadStore = create<ThreadStore>()(
  persist(
    (set) => ({
      threadView: false,
      expandedThreads: new Set(),

      setThreadView: (enabled) => set({ threadView: enabled }),

      toggleThread: (threadId) => set((state) => {
        const newExpanded = new Set(state.expandedThreads);
        if (newExpanded.has(threadId)) {
          newExpanded.delete(threadId);
        } else {
          newExpanded.add(threadId);
        }
        return { expandedThreads: newExpanded };
      }),

      expandThread: (threadId) => set((state) => {
        const newExpanded = new Set(state.expandedThreads);
        newExpanded.add(threadId);
        return { expandedThreads: newExpanded };
      }),

      collapseThread: (threadId) => set((state) => {
        const newExpanded = new Set(state.expandedThreads);
        newExpanded.delete(threadId);
        return { expandedThreads: newExpanded };
      }),

      collapseAll: () => set({ expandedThreads: new Set() }),

      expandAll: (threadIds) => set({ expandedThreads: new Set(threadIds) }),
    }),
    {
      name: 'thread-store',
      partialize: (state) => ({ threadView: state.threadView }),
      // Note: expandedThreads is not persisted - threads start collapsed on app reload
    }
  )
);

// ============================================
// Awaiting Reply Store
// ============================================

type AwaitingStore = {
  // State
  awaitingEmails: Email[];
  awaitingLoading: boolean;
  awaitingError: string | null;

  // Actions
  fetchAwaitingEmails: (accountId: number) => Promise<void>;
  toggleAwaiting: (emailId: number) => Promise<void>;
  clearAwaiting: () => void;
};

export const useAwaitingStore = create<AwaitingStore>((set, get) => ({
  awaitingEmails: [],
  awaitingLoading: false,
  awaitingError: null,

  fetchAwaitingEmails: async (accountId) => {
    set({ awaitingLoading: true, awaitingError: null });
    try {
      // Fetch emails marked as awaiting reply using dedicated endpoint
      const emails = await window.mailApi.awaiting.list(accountId);
      set({ awaitingEmails: emails, awaitingLoading: false });
    } catch (err) {
      set({ awaitingError: String(err), awaitingLoading: false });
    }
  },

  toggleAwaiting: async (emailId) => {
    try {
      // Toggle the awaiting reply status for an email
      const isNowAwaiting = await window.mailApi.awaiting.toggle(emailId);

      if (isNowAwaiting) {
        // Email is now awaiting - would need to re-fetch to get email details
        // For now, just refetch the list
        const accountId = get().awaitingEmails[0]?.accountId;
        if (accountId) {
          const emails = await window.mailApi.awaiting.list(accountId);
          set({ awaitingEmails: emails });
        }
      } else {
        // Email is no longer awaiting - remove from list
        set((state) => ({
          awaitingEmails: state.awaitingEmails.filter(e => e.id !== emailId),
        }));
      }
    } catch (err) {
      set({ awaitingError: String(err) });
    }
  },

  clearAwaiting: () => set({ awaitingEmails: [], awaitingError: null }),
}));

// ============================================
// Send Queue Store (Undo Send)
// ============================================

type PendingSend = {
  id: string;
  expiresAt: Date;
  draft: DraftInput;
  accountId: number;
};

type SendQueueStore = {
  // State
  pendingSend: PendingSend | null;
  sendError: string | null;

  // Actions
  queueSend: (accountId: number, draft: DraftInput) => Promise<{ id: string; expiresAt: Date }>;
  cancelSend: () => Promise<boolean>;
  clearPendingSend: () => void;
  executePendingSend: () => Promise<void>;
};

// Default undo window in milliseconds (5 seconds)
const UNDO_SEND_DELAY_MS = 5000;

export const useSendQueueStore = create<SendQueueStore>((set, get) => ({
  pendingSend: null,
  sendError: null,

  queueSend: async (accountId, draft) => {
    // Generate unique ID for this send operation
    const id = `send-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + UNDO_SEND_DELAY_MS);

    // Store pending send
    set({
      pendingSend: { id, expiresAt, draft, accountId },
      sendError: null,
    });

    // Schedule actual send after delay
    setTimeout(() => {
      const current = get().pendingSend;
      // Only execute if this is still the pending send (not cancelled)
      if (current && current.id === id) {
        get().executePendingSend();
      }
    }, UNDO_SEND_DELAY_MS);

    return { id, expiresAt };
  },

  cancelSend: async () => {
    const { pendingSend } = get();
    if (!pendingSend) {
      return false;
    }

    // Check if still within undo window
    if (new Date() > pendingSend.expiresAt) {
      return false; // Too late to cancel
    }

    // Clear the pending send
    set({ pendingSend: null });
    return true;
  },

  clearPendingSend: () => set({ pendingSend: null, sendError: null }),

  executePendingSend: async () => {
    const { pendingSend } = get();
    if (!pendingSend) return;

    try {
      // Actually send the email
      await window.mailApi.send.email(pendingSend.accountId, pendingSend.draft);
      set({ pendingSend: null, sendError: null });
    } catch (err) {
      set({ sendError: String(err), pendingSend: null });
    }
  },
}));

// Subscribe to license state changes from main process
if (typeof window !== 'undefined' && window.mailApi) {
  window.mailApi.on('license:state-changed', (state: any) => {
    useLicenseStore.setState({
      status: state.status,
      licenseKey: state.licenseKey,
      expiresAt: state.expiresAt ? new Date(state.expiresAt) : null,
      daysUntilExpiry: state.daysUntilExpiry,
      isReadOnly: state.isReadOnly,
    });
  });
}

// ============================================
// Ollama Setup Store
// ============================================

type OllamaSetupPhase = 'idle' | 'checking' | 'downloading-binary' | 'starting' | 'downloading-models' | 'ready' | 'error' | 'skipped';

type OllamaSetupStore = {
  phase: OllamaSetupPhase;
  progress: number; // 0-100
  currentModel: string | null;
  modelsCompleted: number;
  modelsTotal: number;
  error: string | null;
  isReady: boolean; // Convenience flag for UI

  // Actions
  startSetup: () => Promise<void>;
  skipSetup: () => void;
  checkAndStart: () => Promise<void>;
};

const REQUIRED_MODELS = ['mistral:7b', 'qwen2.5:1.5b'];

export const useOllamaSetupStore = create<OllamaSetupStore>((set, get) => ({
  phase: 'idle',
  progress: 0,
  currentModel: null,
  modelsCompleted: 0,
  modelsTotal: REQUIRED_MODELS.length,
  error: null,
  isReady: false,

  checkAndStart: async () => {
    set({ phase: 'checking' });

    try {
      const llmConfig = await window.mailApi.config.get('llm');
      if (llmConfig?.provider !== 'ollama') {
        // Not using Ollama provider, skip setup
        set({ phase: 'skipped', isReady: false });
        return;
      }

      const isInstalled = await window.mailApi.ollama.isInstalled();
      if (isInstalled) {
        // Already installed, check if running
        const isRunning = await window.mailApi.ollama.isRunning();
        if (!isRunning) {
          set({ phase: 'starting' });
          await window.mailApi.ollama.start();
        }
        set({ phase: 'ready', isReady: true });
        return;
      }

      // Not installed - start background setup
      await get().startSetup();
    } catch (err) {
      set({
        phase: 'error',
        error: err instanceof Error ? err.message : 'Setup check failed',
        isReady: false,
      });
    }
  },

  startSetup: async () => {
    set({ phase: 'downloading-binary', progress: 0, error: null });

    try {
      // Step 1: Download binary
      await window.mailApi.ollama.downloadBinary();

      // Step 2: Start server
      set({ phase: 'starting' });
      await window.mailApi.ollama.start();

      // Step 3: Download models
      set({ phase: 'downloading-models', modelsCompleted: 0 });
      for (let i = 0; i < REQUIRED_MODELS.length; i++) {
        const model = REQUIRED_MODELS[i];
        if (!model) continue;
        set({ currentModel: model, modelsCompleted: i });
        await window.mailApi.ollama.pullModel(model);
      }

      // Step 4: Save config with actual server URL from Ollama manager
      const serverUrl = await window.mailApi.ollama.getServerUrl();
      const llmConfig = await window.mailApi.config.get('llm');
      await window.mailApi.config.set('llm', {
        ...llmConfig,
        provider: 'ollama',
        model: REQUIRED_MODELS[0],
        ollamaServerUrl: serverUrl,
      });

      set({
        phase: 'ready',
        isReady: true,
        modelsCompleted: REQUIRED_MODELS.length,
        currentModel: null,
      });
    } catch (err) {
      set({
        phase: 'error',
        error: err instanceof Error ? err.message : 'Setup failed',
        isReady: false,
      });
    }
  },

  skipSetup: () => {
    set({ phase: 'skipped', isReady: false });
  },
}));

// Listen for download progress events
if (typeof window !== 'undefined' && window.mailApi) {
  window.mailApi.on('ollama:download-progress', (data: any) => {
    const store = useOllamaSetupStore.getState();
    if (store.phase === 'downloading-binary' && data.phase === 'binary') {
      useOllamaSetupStore.setState({ progress: data.percent });
    } else if (store.phase === 'downloading-models' && data.phase === 'model') {
      useOllamaSetupStore.setState({ progress: data.percent });
    }
  });
}
