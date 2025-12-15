/**
 * Zustand Stores
 * 
 * State management connecting UI to backend via IPC.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Email, EmailBody, Attachment, Tag, AppliedTag, Account, SyncProgress, Draft, DraftInput, ClassificationStats, ClassificationFeedback, ConfusedPattern, ClassificationState } from '../../core/domain';

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
        delete: (id: number) => Promise<void>;
      };
      attachments: {
        getForEmail: (emailId: number) => Promise<Attachment[]>;
        download: (attachmentId: number, action?: 'open' | 'save') => Promise<{ path: string; action: string }>;
      };
      tags: {
        list: () => Promise<Tag[]>;
        getForEmail: (emailId: number) => Promise<AppliedTag[]>;
        apply: (emailId: number, tagId: number, source?: string) => Promise<void>;
        remove: (emailId: number, tagId: number) => Promise<void>;
      };
      accounts: {
        list: () => Promise<Account[]>;
        get: (id: number) => Promise<Account | null>;
        testImap: (email: string, host: string, port: number) => Promise<{ ok: boolean; error?: string }>;
        testSmtp: (email: string, host: string, port: number) => Promise<{ ok: boolean; error?: string }>;
        create: (account: any, password: string) => Promise<Account>;
        add: (account: any, password: string, options?: { skipSync?: boolean }) => Promise<{
          account: Account;
          syncResult: { newCount: number; newEmailIds: number[] };
          maxMessagesPerFolder: number;
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
        start: (accountId: number, opts?: any) => Promise<number>;
        startAll: (opts?: any) => Promise<number>;
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
      };
      security: {
        getConfig: () => Promise<any>;
        setConfig: (updates: any) => Promise<void>;
        clearSession: () => Promise<void>;
        isBiometricAvailable: () => Promise<boolean>;
      };
      images: {
        getSetting: () => Promise<'block' | 'allow'>;
        setSetting: (setting: 'block' | 'allow') => Promise<void>;
        hasLoaded: (emailId: number) => Promise<boolean>;
        load: (emailId: number, urls: string[]) => Promise<{ url: string; localPath: string }[]>;
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
        getStats: () => Promise<ClassificationStats>;
        getPendingReview: (opts?: { sortBy?: string; limit?: number; accountId?: number }) => Promise<ReviewItem[]>;
        accept: (emailId: number, appliedTags: string[]) => Promise<void>;
        dismiss: (emailId: number) => Promise<void>;
        bulkAccept: (emailIds: number[]) => Promise<void>;
        bulkDismiss: (emailIds: number[]) => Promise<void>;
        getConfusedPatterns: (limit?: number) => Promise<ConfusedPattern[]>;
        getRecentActivity: (limit?: number) => Promise<ClassificationFeedback[]>;
        classifyUnprocessed: () => Promise<number>;
        clearConfusedPatterns: () => Promise<void>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}

// ============================================
// Email Store
// ============================================

type EmailStore = {
  emails: Email[];
  emailTagsMap: Record<number, AppliedTag[]>;  // Map emailId -> tags
  selectedId: number | null;
  selectedEmail: Email | null;
  selectedBody: EmailBody | null;
  selectedTags: AppliedTag[];
  selectedAttachments: Attachment[];
  loading: boolean;
  loadingBody: boolean;
  error: string | null;

  // Filters
  filter: {
    tagId?: number;
    folderPath?: string;  // Filter by folder path (e.g., 'Sent', 'INBOX')
    unreadOnly?: boolean;
    starredOnly?: boolean;
    searchQuery?: string;
  };

  // Actions
  loadEmails: (accountId?: number) => Promise<void>;
  selectEmail: (id: number | null) => Promise<void>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  archive: (id: number) => Promise<void>;
  deleteEmail: (id: number) => Promise<void>;
  search: (query: string, accountId: number) => Promise<void>;
  setFilter: (filter: Partial<EmailStore['filter']>, accountId: number) => void;
  clearFilter: (accountId: number) => void;
  downloadAttachment: (attachmentId: number, action?: 'open' | 'save') => Promise<void>;
  refreshSelectedTags: () => Promise<void>;
  getEmailTags: (emailId: number) => AppliedTag[];
};

export const useEmailStore = create<EmailStore>((set, get) => ({
  emails: [],
  emailTagsMap: {},
  selectedId: null,
  selectedEmail: null,
  selectedBody: null,
  selectedTags: [],
  selectedAttachments: [],
  loading: false,
  loadingBody: false,
  error: null,
  filter: {},

  loadEmails: async (accountId?: number) => {
    set({ loading: true, error: null });
    try {
      const { filter } = get();

      // Don't load if no account provided
      if (!accountId) {
        set({ emails: [], emailTagsMap: {}, loading: false });
        return;
      }

      let emails: Email[];

      if (filter.searchQuery) {
        emails = await window.mailApi.emails.search(filter.searchQuery, 100, accountId);
      } else {
        emails = await window.mailApi.emails.list({
          accountId,
          tagId: filter.tagId,
          folderPath: filter.folderPath,
          unreadOnly: filter.unreadOnly,
          starredOnly: filter.starredOnly,
          limit: 100,
        });
      }

      // Load tags for all emails in parallel
      const tagsMap: Record<number, AppliedTag[]> = {};
      await Promise.all(
        emails.map(async (email) => {
          const tags = await window.mailApi.tags.getForEmail(email.id);
          tagsMap[email.id] = tags;
        })
      );

      set({ emails, emailTagsMap: tagsMap, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  selectEmail: async (id) => {
    if (id === null) {
      set({ selectedId: null, selectedEmail: null, selectedBody: null, selectedTags: [], selectedAttachments: [] });
      return;
    }

    set({ selectedId: id, loadingBody: true });

    try {
      const [email, body, tags, attachments] = await Promise.all([
        window.mailApi.emails.get(id),
        window.mailApi.emails.getBody(id),
        window.mailApi.tags.getForEmail(id),
        window.mailApi.attachments.getForEmail(id),
      ]);

      set({
        selectedEmail: email,
        selectedBody: body,
        selectedTags: tags,
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

  deleteEmail: async (id) => {
    await window.mailApi.emails.delete(id);
    set(state => ({
      emails: state.emails.filter(e => e.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      selectedEmail: state.selectedId === id ? null : state.selectedEmail,
      selectedBody: state.selectedId === id ? null : state.selectedBody,
      selectedTags: state.selectedId === id ? [] : state.selectedTags,
      selectedAttachments: state.selectedId === id ? [] : state.selectedAttachments,
    }));
  },

  search: async (query, accountId) => {
    set({ filter: { searchQuery: query } });
    await get().loadEmails(accountId);
  },

  setFilter: (filter, accountId) => {
    set(state => ({ filter: { ...state.filter, ...filter } }));
    get().loadEmails(accountId);
  },

  clearFilter: (accountId) => {
    set({ filter: {} });
    get().loadEmails(accountId);
  },

  downloadAttachment: async (attachmentId, action = 'open') => {
    try {
      await window.mailApi.attachments.download(attachmentId, action);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  refreshSelectedTags: async () => {
    const { selectedId } = get();
    if (!selectedId) return;

    const tags = await window.mailApi.tags.getForEmail(selectedId);
    set({ selectedTags: tags });

    // Also update the emailTagsMap
    set(state => ({
      emailTagsMap: { ...state.emailTagsMap, [selectedId]: tags },
    }));
  },

  getEmailTags: (emailId: number) => {
    return get().emailTagsMap[emailId] || [];
  },
}));

// ============================================
// Tag Store
// ============================================

type TagStore = {
  tags: Tag[];
  loading: boolean;
  
  loadTags: () => Promise<void>;
  applyTag: (emailId: number, tagId: number) => Promise<void>;
  removeTag: (emailId: number, tagId: number) => Promise<void>;
};

export const useTagStore = create<TagStore>((set) => ({
  tags: [],
  loading: false,

  loadTags: async () => {
    set({ loading: true });
    const tags = await window.mailApi.tags.list();
    set({ tags, loading: false });
  },

  applyTag: async (emailId, tagId) => {
    await window.mailApi.tags.apply(emailId, tagId);
  },

  removeTag: async (emailId, tagId) => {
    await window.mailApi.tags.remove(emailId, tagId);
  },
}));

// ============================================
// Sync Store
// ============================================

type SyncStore = {
  syncing: boolean;
  progress: SyncProgress | null;
  lastSync: Date | null;

  startSync: (accountId: number) => Promise<void>;
  startSyncAll: () => Promise<void>;
  setProgress: (progress: SyncProgress | null) => void;
};

export const useSyncStore = create<SyncStore>((set) => ({
  syncing: false,
  progress: null,
  lastSync: null,

  // Sync specified account - caller provides accountId (no cross-store coupling)
  startSync: async (accountId: number) => {
    set({ syncing: true });
    try {
      await window.mailApi.sync.start(accountId);
      set({ lastSync: new Date() });
      // Note: Caller should reload emails after sync completes
    } finally {
      set({ syncing: false, progress: null });
    }
  },

  // Sync all accounts
  startSyncAll: async () => {
    set({ syncing: true });
    try {
      await window.mailApi.sync.startAll();
      set({ lastSync: new Date() });
      // Note: Caller should reload emails after sync completes
    } finally {
      set({ syncing: false, progress: null });
    }
  },

  setProgress: (progress) => set({ progress }),
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

type View = 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'drafts' | 'settings' | 'ai-sort';
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
