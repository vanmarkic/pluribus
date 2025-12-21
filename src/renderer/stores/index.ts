/**
 * Zustand Stores
 * 
 * State management connecting UI to backend via IPC.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// Tags removed - using folders for organization (Issue #54)
import type { Email, EmailBody, Attachment, Account, SyncProgress, Draft, DraftInput, ClassificationStats, ClassificationFeedback, ConfusedPattern, ClassificationState, RecentContact } from '../../core/domain';

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
// Email Store
// ============================================

// Maximum emails to keep in memory - evict oldest when exceeded
const MAX_CACHED_EMAILS = 500;

type EmailStore = {
  emails: Email[];
  // emailTagsMap removed - using folders for organization (Issue #54)
  selectedId: number | null;
  selectedEmail: Email | null;
  selectedBody: EmailBody | null;
  // selectedTags removed - using folders for organization (Issue #54)
  selectedAttachments: Attachment[];
  loading: boolean;
  loadingBody: boolean;
  loadingMore: boolean;
  error: string | null;

  // Multiselect state
  selectedIds: Set<number>;
  focusedId: number | null;  // Keyboard focus (different from selectedId which opens email)

  // Pagination
  offset: number;
  hasMore: boolean;

  // Filters
  filter: {
    // tagId removed - using folders for organization (Issue #54)
    folderPath?: string;  // Filter by folder path (e.g., 'Sent', 'INBOX')
    unreadOnly?: boolean;
    starredOnly?: boolean;
    searchQuery?: string;
  };

  // Actions
  loadEmails: (accountId?: number) => Promise<void>;
  loadMore: (accountId: number) => Promise<void>;
  selectEmail: (id: number | null) => Promise<void>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  archive: (id: number) => Promise<void>;
  unarchive: (id: number) => Promise<void>;
  deleteEmail: (id: number) => Promise<void>;
  search: (query: string, accountId: number) => Promise<void>;
  setFilter: (filter: Partial<EmailStore['filter']>, accountId: number) => void;
  clearFilter: (accountId: number) => void;
  downloadAttachment: (attachmentId: number, action?: 'open' | 'save') => Promise<void>;
  // refreshSelectedTags and getEmailTags removed - using folders (Issue #54)

  // Multiselect actions
  toggleSelect: (id: number) => void;
  selectRange: (fromId: number, toId: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setFocusedId: (id: number | null) => void;

  // Bulk actions
  bulkArchive: () => Promise<void>;
  bulkTrash: () => Promise<void>;
  bulkMarkRead: (isRead: boolean) => Promise<void>;
};

export const useEmailStore = create<EmailStore>((set, get) => ({
  emails: [],
  // emailTagsMap removed (Issue #54)
  selectedId: null,
  selectedEmail: null,
  selectedBody: null,
  // selectedTags removed (Issue #54)
  selectedAttachments: [],
  loading: false,
  loadingBody: false,
  loadingMore: false,
  error: null,
  selectedIds: new Set(),
  focusedId: null,
  offset: 0,
  hasMore: true,
  filter: {},

  loadEmails: async (accountId?: number) => {
    set({ loading: true, error: null });
    try {
      const { filter } = get();

      // Don't load if no account provided
      if (!accountId) {
        set({ emails: [], loading: false });
        return;
      }

      let emails: Email[];

      if (filter.searchQuery) {
        emails = await window.mailApi.emails.search(filter.searchQuery, 100, accountId);
      } else {
        emails = await window.mailApi.emails.list({
          accountId,
          // tagId removed - using folders (Issue #54)
          folderPath: filter.folderPath,
          unreadOnly: filter.unreadOnly,
          starredOnly: filter.starredOnly,
          limit: 100,
        });
      }

      // Tags loading removed - using folders (Issue #54)

      // Apply LRU eviction if we exceed the limit
      let finalEmails = emails;

      if (finalEmails.length > MAX_CACHED_EMAILS) {
        // Keep most recent emails (they're already sorted by date desc from backend)
        finalEmails = finalEmails.slice(0, MAX_CACHED_EMAILS);
      }

      // Auto-select first email if emails are available and nothing is currently selected
      const currentSelectedId = get().selectedId;
      const shouldAutoSelect = finalEmails.length > 0 && !currentSelectedId;
      const newSelectedId = shouldAutoSelect ? finalEmails[0].id : currentSelectedId;

      set({
        emails: finalEmails,
        selectedId: newSelectedId,
        loading: false,
        offset: 0,
        hasMore: emails.length === 100,
      });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  loadMore: async (accountId: number) => {
    const { emails, filter, offset, hasMore, loadingMore } = get();

    // Don't load if already loading or no more emails
    if (loadingMore || !hasMore) return;

    set({ loadingMore: true, error: null });
    try {
      let moreEmails: Email[];
      const newOffset = offset + emails.length;

      if (filter.searchQuery) {
        // For search, we can't use offset, so just return
        set({ loadingMore: false, hasMore: false });
        return;
      } else {
        moreEmails = await window.mailApi.emails.list({
          accountId,
          // tagId removed - using folders (Issue #54)
          folderPath: filter.folderPath,
          unreadOnly: filter.unreadOnly,
          starredOnly: filter.starredOnly,
          limit: 100,
          offset: newOffset,
        });
      }

      // Tags loading removed - using folders (Issue #54)

      // Combine with existing emails
      const combinedEmails = [...emails, ...moreEmails];

      // Apply LRU eviction if we exceed the limit
      let finalEmails = combinedEmails;

      if (finalEmails.length > MAX_CACHED_EMAILS) {
        // Keep most recent emails (they're already sorted by date desc from backend)
        finalEmails = finalEmails.slice(0, MAX_CACHED_EMAILS);
      }

      set({
        emails: finalEmails,
        loadingMore: false,
        hasMore: moreEmails.length === 100,
      });
    } catch (err) {
      set({ error: String(err), loadingMore: false });
    }
  },

  selectEmail: async (id) => {
    if (id === null) {
      set({ selectedId: null, selectedEmail: null, selectedBody: null, selectedAttachments: [] });
      return;
    }

    set({ selectedId: id, loadingBody: true });

    try {
      // Tags loading removed - using folders (Issue #54)
      const [email, body, attachments] = await Promise.all([
        window.mailApi.emails.get(id),
        window.mailApi.emails.getBody(id),
        window.mailApi.attachments.getForEmail(id),
      ]);

      set({
        selectedEmail: email,
        selectedBody: body,
        // selectedTags removed (Issue #54)
        selectedAttachments: attachments,
        loadingBody: false,
      });

      // Mark as read
      if (email && !email.isRead) {
        await window.mailApi.emails.markRead(id, true);
        set(state => ({
          emails: state.emails.map(e => e.id === id ? { ...e, isRead: true } : e),
          selectedEmail: state.selectedEmail ? { ...state.selectedEmail, isRead: true } : null,
        }));
      }
    } catch (err) {
      set({ error: String(err), loadingBody: false });
    }
  },

  markRead: async (id, isRead) => {
    await window.mailApi.emails.markRead(id, isRead);
    set(state => ({
      emails: state.emails.map(e => e.id === id ? { ...e, isRead } : e),
      selectedEmail: state.selectedEmail?.id === id 
        ? { ...state.selectedEmail, isRead } 
        : state.selectedEmail,
    }));
  },

  toggleStar: async (id) => {
    const email = get().emails.find(e => e.id === id);
    if (!email) return;
    
    const isStarred = !email.isStarred;
    await window.mailApi.emails.star(id, isStarred);
    
    set(state => ({
      emails: state.emails.map(e => e.id === id ? { ...e, isStarred } : e),
      selectedEmail: state.selectedEmail?.id === id 
        ? { ...state.selectedEmail, isStarred } 
        : state.selectedEmail,
    }));
  },

  archive: async (id) => {
    await window.mailApi.emails.archive(id);
    set(state => ({
      emails: state.emails.filter(e => e.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      selectedEmail: state.selectedId === id ? null : state.selectedEmail,
    }));
  },

  unarchive: async (id) => {
    await window.mailApi.emails.unarchive(id);
    set(state => ({
      emails: state.emails.filter(e => e.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      selectedEmail: state.selectedId === id ? null : state.selectedEmail,
    }));
  },

  deleteEmail: async (id) => {
    // Move to Trash via IMAP instead of permanent deletion
    await window.mailApi.emails.trash(id);
    set(state => ({
      // Remove from current view (email is now in Trash folder)
      emails: state.emails.filter(e => e.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      selectedEmail: state.selectedId === id ? null : state.selectedEmail,
      selectedBody: state.selectedId === id ? null : state.selectedBody,
      selectedAttachments: state.selectedId === id ? [] : state.selectedAttachments,
    }));
  },

  search: async (query, accountId) => {
    set({
      filter: { searchQuery: query },
      selectedId: null,
      selectedEmail: null,
      selectedBody: null,
      selectedAttachments: []
    });
    await get().loadEmails(accountId);
  },

  setFilter: (filter, accountId) => {
    set(state => ({
      filter: { ...state.filter, ...filter },
      selectedId: null,
      selectedEmail: null,
      selectedBody: null,
      selectedAttachments: []
    }));
    get().loadEmails(accountId);
  },

  clearFilter: (accountId) => {
    set({
      filter: {},
      selectedId: null,
      selectedEmail: null,
      selectedBody: null,
      selectedAttachments: []
    });
    get().loadEmails(accountId);
  },

  downloadAttachment: async (attachmentId, action = 'open') => {
    try {
      await window.mailApi.attachments.download(attachmentId, action);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // refreshSelectedTags and getEmailTags removed - using folders (Issue #54)

  toggleSelect: (id) => {
    set(state => {
      const newSelected = new Set(state.selectedIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { selectedIds: newSelected };
    });
  },

  selectRange: (fromId, toId) => {
    const { emails } = get();
    const fromIndex = emails.findIndex(e => e.id === fromId);
    const toIndex = emails.findIndex(e => e.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = emails.slice(start, end + 1).map(e => e.id);

    set(state => ({
      selectedIds: new Set([...state.selectedIds, ...rangeIds]),
    }));
  },

  selectAll: () => {
    const { emails } = get();
    set({ selectedIds: new Set(emails.map(e => e.id)) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set() });
  },

  setFocusedId: (id) => {
    set({ focusedId: id });
  },

  bulkArchive: async () => {
    const { selectedIds, emails } = get();
    const ids = Array.from(selectedIds);

    // Archive all selected
    await Promise.all(ids.map(id => window.mailApi.emails.archive(id)));

    // Remove from list and clear selection
    set({
      emails: emails.filter(e => !selectedIds.has(e.id)),
      selectedIds: new Set(),
      selectedId: null,
      selectedEmail: null,
    });
  },

  bulkTrash: async () => {
    const { selectedIds, emails } = get();
    const ids = Array.from(selectedIds);

    // Trash all selected
    await Promise.all(ids.map(id => window.mailApi.emails.trash(id)));

    // Remove from list and clear selection
    set({
      emails: emails.filter(e => !selectedIds.has(e.id)),
      selectedIds: new Set(),
      selectedId: null,
      selectedEmail: null,
    });
  },

  bulkMarkRead: async (isRead) => {
    const { selectedIds, emails } = get();
    const ids = Array.from(selectedIds);

    // Mark all selected
    await Promise.all(ids.map(id => window.mailApi.emails.markRead(id, isRead)));

    // Update local state
    set({
      emails: emails.map(e => selectedIds.has(e.id) ? { ...e, isRead } : e),
      selectedIds: new Set(),
    });
  },
}));

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
        if ((!selectedAccountId || !accountExists) && accounts.length > 0) {
          set({ selectedAccountId: accounts[0].id });
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
