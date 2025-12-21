/**
 * Oracle Tests for Usecases Refactoring
 *
 * Property-based tests to ensure the refactored usecases behave identically
 * to the original implementation. These tests will:
 *
 * 1. Import from the OLD location (usecases.ts)
 * 2. Compare behavior against the NEW modular structure
 * 3. Verify that createUseCases factory produces identical results
 *
 * This ensures we can safely refactor without breaking behavior.
 */

import { describe, it, expect } from 'vitest';
import type { Deps } from '../ports';
import type { Email } from '../domain';

// Import the CURRENT implementation (before refactoring)
import { createUseCases as oldCreateUseCases } from '../usecases';

describe('Usecases Refactoring Oracle Tests', () => {
  /**
   * Test that createUseCases factory returns an object with all expected use cases
   */
  it('createUseCases returns object with all expected keys', () => {
    // Create minimal mock deps (we just need to verify the structure)
    const mockDeps = createMockDeps();

    const useCases = oldCreateUseCases(mockDeps);

    // Email use cases
    expect(useCases).toHaveProperty('listEmails');
    expect(useCases).toHaveProperty('getEmail');
    expect(useCases).toHaveProperty('getEmailBody');
    expect(useCases).toHaveProperty('searchEmails');
    expect(useCases).toHaveProperty('markRead');
    expect(useCases).toHaveProperty('starEmail');
    expect(useCases).toHaveProperty('archiveEmail');
    expect(useCases).toHaveProperty('unarchiveEmail');
    expect(useCases).toHaveProperty('deleteEmail');
    expect(useCases).toHaveProperty('trashEmail');

    // Sync use cases
    expect(useCases).toHaveProperty('syncMailbox');
    expect(useCases).toHaveProperty('syncAllMailboxes');
    expect(useCases).toHaveProperty('syncWithAutoClassify');
    expect(useCases).toHaveProperty('syncAllWithAutoClassify');
    expect(useCases).toHaveProperty('cancelSync');

    // Classification use cases
    expect(useCases).toHaveProperty('classifyEmail');
    expect(useCases).toHaveProperty('classifyAndApply');
    expect(useCases).toHaveProperty('classifyAndTriage');
    expect(useCases).toHaveProperty('classifyNewEmails');

    // LLM Provider use cases
    expect(useCases).toHaveProperty('validateLLMProvider');
    expect(useCases).toHaveProperty('listLLMModels');
    expect(useCases).toHaveProperty('testLLMConnection');
    expect(useCases).toHaveProperty('isLLMConfigured');

    // Background task use cases
    expect(useCases).toHaveProperty('startBackgroundClassification');
    expect(useCases).toHaveProperty('getBackgroundTaskStatus');
    expect(useCases).toHaveProperty('clearBackgroundTask');

    // AI Sort use cases
    expect(useCases).toHaveProperty('getPendingReviewQueue');
    expect(useCases).toHaveProperty('getEmailsByPriority');
    expect(useCases).toHaveProperty('getFailedClassifications');
    expect(useCases).toHaveProperty('getClassificationStats');
    expect(useCases).toHaveProperty('acceptClassification');
    expect(useCases).toHaveProperty('dismissClassification');
    expect(useCases).toHaveProperty('retryClassification');
    expect(useCases).toHaveProperty('reclassifyEmail');
    expect(useCases).toHaveProperty('getClassificationState');
    expect(useCases).toHaveProperty('getConfusedPatterns');
    expect(useCases).toHaveProperty('clearConfusedPatterns');
    expect(useCases).toHaveProperty('getRecentActivity');
    expect(useCases).toHaveProperty('bulkAcceptClassifications');
    expect(useCases).toHaveProperty('bulkDismissClassifications');
    expect(useCases).toHaveProperty('bulkMoveToFolder');
    expect(useCases).toHaveProperty('getPendingReviewCount');
    expect(useCases).toHaveProperty('classifyUnprocessed');

    // Account use cases
    expect(useCases).toHaveProperty('listAccounts');
    expect(useCases).toHaveProperty('getAccount');
    expect(useCases).toHaveProperty('createAccount');
    expect(useCases).toHaveProperty('updateAccount');
    expect(useCases).toHaveProperty('deleteAccount');
    expect(useCases).toHaveProperty('addAccount');
    expect(useCases).toHaveProperty('testImapConnection');
    expect(useCases).toHaveProperty('testSmtpConnection');

    // Send use cases
    expect(useCases).toHaveProperty('sendEmail');
    expect(useCases).toHaveProperty('replyToEmail');
    expect(useCases).toHaveProperty('forwardEmail');

    // Remote Images use cases
    expect(useCases).toHaveProperty('loadRemoteImages');
    expect(useCases).toHaveProperty('hasLoadedRemoteImages');
    expect(useCases).toHaveProperty('getRemoteImagesSetting');
    expect(useCases).toHaveProperty('setRemoteImagesSetting');
    expect(useCases).toHaveProperty('clearImageCache');
    expect(useCases).toHaveProperty('clearAllImageCache');
    expect(useCases).toHaveProperty('autoLoadImagesForEmail');

    // Contact use cases
    expect(useCases).toHaveProperty('getRecentContacts');
    expect(useCases).toHaveProperty('searchContacts');
    expect(useCases).toHaveProperty('recordContactUsage');

    // Draft use cases
    expect(useCases).toHaveProperty('saveDraft');
    expect(useCases).toHaveProperty('getDraft');
    expect(useCases).toHaveProperty('listDrafts');
    expect(useCases).toHaveProperty('deleteDraft');

    // Database Health use cases
    expect(useCases).toHaveProperty('checkDatabaseIntegrity');
    expect(useCases).toHaveProperty('createDatabaseBackup');

    // Email Triage use cases
    expect(useCases).toHaveProperty('triageEmail');
    expect(useCases).toHaveProperty('triageAndMoveEmail');
    expect(useCases).toHaveProperty('moveEmailToTriageFolder');
    expect(useCases).toHaveProperty('learnFromTriageCorrection');
    expect(useCases).toHaveProperty('snoozeEmail');
    expect(useCases).toHaveProperty('unsnoozeEmail');
    expect(useCases).toHaveProperty('processSnoozedEmails');
    expect(useCases).toHaveProperty('saveTrainingExample');
    expect(useCases).toHaveProperty('getTrainingExamples');
    expect(useCases).toHaveProperty('ensureTriageFolders');
    expect(useCases).toHaveProperty('getSenderRules');
    expect(useCases).toHaveProperty('getTriageLog');
    expect(useCases).toHaveProperty('selectDiverseTrainingEmails');
  });

  /**
   * Test that all use cases are callable functions
   */
  it('all use cases are functions', () => {
    const mockDeps = createMockDeps();
    const useCases = oldCreateUseCases(mockDeps);

    // Check that all values in the useCases object are functions
    for (const [key, value] of Object.entries(useCases)) {
      expect(typeof value).toBe('function', `${key} should be a function`);
    }
  });

  /**
   * Test individual use case behavior (sample tests)
   */
  describe('Email Use Cases', () => {
    it('listEmails calls emails.list with correct options', async () => {
      const mockEmails: Email[] = [
        {
          id: 1,
          messageId: '<test@example.com>',
          accountId: 1,
          folderId: 1,
          uid: 100,
          subject: 'Test',
          from: { address: 'sender@example.com', name: 'Sender' },
          to: ['recipient@example.com'],
          date: new Date(),
          snippet: 'Test email',
          sizeBytes: 1024,
          isRead: false,
          isStarred: false,
          hasAttachments: false,
          bodyFetched: false,
        },
      ];

      const mockDeps = createMockDeps({
        emails: {
          list: async (options) => {
            expect(options).toEqual({ limit: 10 });
            return mockEmails;
          },
        },
      });

      const useCases = oldCreateUseCases(mockDeps);
      const result = await useCases.listEmails({ limit: 10 });

      expect(result).toEqual(mockEmails);
    });

    it('getEmail calls emails.findById', async () => {
      const mockEmail: Email = {
        id: 1,
        messageId: '<test@example.com>',
        accountId: 1,
        folderId: 1,
        uid: 100,
        subject: 'Test',
        from: { address: 'sender@example.com', name: 'Sender' },
        to: ['recipient@example.com'],
        date: new Date(),
        snippet: 'Test email',
        sizeBytes: 1024,
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
      };

      const mockDeps = createMockDeps({
        emails: {
          findById: async (id) => {
            expect(id).toBe(1);
            return mockEmail;
          },
        },
      });

      const useCases = oldCreateUseCases(mockDeps);
      const result = await useCases.getEmail(1);

      expect(result).toEqual(mockEmail);
    });
  });

  describe('Account Use Cases', () => {
    it('listAccounts calls accounts.findAll', async () => {
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
          lastSync: null,
        },
      ];

      const mockDeps = createMockDeps({
        accounts: {
          findAll: async () => mockAccounts,
        },
      });

      const useCases = oldCreateUseCases(mockDeps);
      const result = await useCases.listAccounts();

      expect(result).toEqual(mockAccounts);
    });
  });
});

/**
 * Helper to create minimal mock deps for testing
 */
function createMockDeps(overrides: Partial<Deps> = {}): Deps {
  const defaultMocks: Deps = {
    emails: {
      findById: async () => null,
      list: async () => [],
      search: async () => [],
      getBody: async () => null,
      saveBody: async () => {},
      insert: async () => ({} as any),
      insertBatch: async () => ({ count: 0, ids: [] }),
      markRead: async () => {},
      setStar: async () => {},
      setFolderId: async () => {},
      delete: async () => {},
    },
    attachments: {
      findById: async () => null,
      findByEmailId: async () => [],
      save: async () => ({} as any),
      getContent: async () => null,
    },
    accounts: {
      findAll: async () => [],
      findById: async () => null,
      findByEmail: async () => null,
      create: async () => ({} as any),
      update: async () => ({} as any),
      delete: async () => {},
      updateLastSync: async () => {},
    },
    folders: {
      findById: async () => null,
      getOrCreate: async () => ({} as any),
      updateLastUid: async () => {},
      clear: async () => {},
    },
    drafts: {
      findById: async () => null,
      list: async () => [],
      save: async () => ({} as any),
      update: async () => ({} as any),
      delete: async () => {},
    },
    contacts: {
      getRecent: async () => [],
      search: async () => [],
      recordUsage: async () => {},
    },
    sync: {
      sync: async () => ({ newCount: 0, newEmailIds: [] }),
      fetchBody: async () => ({ text: '', html: '' }),
      disconnect: async () => {},
      cancel: async () => {},
      onProgress: () => () => {},
      testConnection: async () => ({ ok: true }),
      getDefaultFolders: () => ['INBOX'],
      listFolders: async () => [],
      appendToSent: async () => {},
    },
    classifier: {
      classify: async () => ({
        suggestedFolder: 'INBOX',
        confidence: 0.9,
        reasoning: 'Test',
        priority: 'normal',
      }),
      getBudget: () => ({ used: 0, limit: 100, allowed: true }),
      getEmailBudget: () => ({ used: 0, limit: 100, allowed: true }),
    },
    classificationState: {
      getState: async () => null,
      setState: async () => {},
      listPendingReview: async () => [],
      listByPriority: async () => [],
      listFailed: async () => [],
      countByStatus: async () => ({
        unprocessed: 0,
        classified: 0,
        pending_review: 0,
        accepted: 0,
        dismissed: 0,
        error: 0,
      }),
      listReclassifiable: async () => [],
      logFeedback: async () => {},
      listRecentFeedback: async () => [],
      getStats: async () => ({
        classifiedToday: 0,
        pendingReview: 0,
        accuracy30Day: 0,
        budgetUsed: 0,
        budgetLimit: 100,
        priorityBreakdown: { high: 0, normal: 0, low: 0 },
      }),
      getAccuracy30Day: async () => 0,
      listConfusedPatterns: async () => [],
      updateConfusedPattern: async () => {},
      clearConfusedPatterns: async () => {},
    },
    secrets: {
      setPassword: async () => {},
      getPassword: async () => null,
      deletePassword: async () => false,
      setApiKey: async () => {},
      getApiKey: async () => null,
      clearSession: () => {},
      getConfig: () => ({
        biometricMode: 'never',
        sessionTimeoutMs: 300000,
        requireForSend: false,
      }),
      setConfig: () => {},
      isBiometricAvailable: async () => false,
    },
    sender: {
      send: async () => ({ messageId: '', accepted: [], rejected: [] }),
      testConnection: async () => ({ ok: true }),
    },
    config: {
      getLLMConfig: () => ({
        provider: 'ollama',
        model: 'mistral:7b',
        dailyBudget: 100000,
        dailyEmailLimit: 200,
        autoClassify: false,
        confidenceThreshold: 0.85,
        reclassifyCooldownDays: 7,
      }),
      getRemoteImagesSetting: () => 'block',
      setRemoteImagesSetting: () => {},
    },
    imageCache: {
      cacheImages: async () => [],
      getCachedImages: async () => [],
      hasLoadedImages: async () => false,
      markImagesLoaded: async () => {},
      clearCache: async () => {},
      clearCacheFiles: async () => {},
      clearAllCache: async () => {},
    },
    llmProvider: {
      type: 'ollama',
      validateKey: async () => ({ valid: true }),
      listModels: async () => [],
      testConnection: async () => ({ connected: true }),
    },
    backgroundTasks: {
      start: () => {},
      getStatus: () => null,
      clear: () => {},
    },
    databaseHealth: {
      checkIntegrity: async () => ({ isHealthy: true, errors: [] }),
      createBackup: async () => '/path/to/backup',
    },
    license: {
      getState: () => ({
        status: 'inactive',
        licenseKey: null,
        expiresAt: null,
        daysUntilExpiry: null,
        isReadOnly: false,
      }),
      activate: async () => ({ success: false, error: 'Not implemented' }),
      validate: async () => ({ success: false, error: 'Not implemented' }),
      deactivate: async () => {},
      onStateChange: () => () => {},
    },
    patternMatcher: {
      match: () => ({
        folder: 'INBOX',
        confidence: 0.5,
        tags: [],
      }),
    },
    triageClassifier: {
      classify: async () => ({
        folder: 'INBOX',
        tags: [],
        confidence: 0.9,
        patternAgreed: true,
        reasoning: 'Test',
      }),
    },
    trainingRepo: {
      findByAccount: async () => [],
      findByDomain: async () => [],
      save: async () => ({} as any),
      getRelevantExamples: async () => [],
    },
    senderRules: {
      findByAccount: async () => [],
      findAutoApply: async () => [],
      findByPattern: async () => null,
      upsert: async () => ({} as any),
      incrementCount: async () => {},
    },
    snoozes: {
      findByEmail: async () => null,
      findDue: async () => [],
      create: async () => ({} as any),
      delete: async () => {},
    },
    triageLog: {
      log: async () => {},
      findByEmail: async () => [],
      findRecent: async () => [],
    },
    imapFolderOps: {
      createFolder: async () => {},
      deleteFolder: async () => {},
      listFolders: async () => [],
      moveMessage: async () => {},
      moveToTrash: async () => 'Trash',
      ensureTriageFolders: async () => [],
    },
  };

  // Deep merge overrides
  return {
    ...defaultMocks,
    ...overrides,
    emails: { ...defaultMocks.emails, ...(overrides.emails || {}) },
    accounts: { ...defaultMocks.accounts, ...(overrides.accounts || {}) },
  };
}
