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
      on: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}


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
  | 'planning' | 'review' | 'feed' | 'social' | 'promotions'
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
