import { describe, it, expect, vi } from 'vitest';
import type { Email, EmailBody, Tag, AppliedTag, Account, Classification } from './domain';
import type { EmailRepo, TagRepo, AccountRepo, MailSync, Classifier, SecureStorage, MailSender, ConfigStore, SmtpConfig, ClassificationStateRepo, LLMConfig, LLMProvider, BackgroundTaskManager, TaskState } from './ports';
import {
  listEmails,
  getEmail,
  getEmailBody,
  searchEmails,
  markRead,
  starEmail,
  archiveEmail,
  deleteEmail,
  listTags,
  getEmailTags,
  applyTag,
  removeTag,
  createTag,
  syncMailbox,
  syncAllMailboxes,
  syncWithAutoClassify,
  syncAllWithAutoClassify,
  classifyEmail,
  classifyAndApply,
  classifyNewEmails,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  addAccount,
  testImapConnection,
  testSmtpConnection,
  sendEmail,
  replyToEmail,
  forwardEmail,
  loadRemoteImages,
  hasLoadedRemoteImages,
  getRemoteImagesSetting,
  setRemoteImagesSetting,
  clearImageCache,
  getPendingReviewQueue,
  getClassificationStats,
  acceptClassification,
  dismissClassification,
  getConfusedPatterns,
  getPendingReviewCount,
  isLLMConfigured,
  startBackgroundClassification,
  getBackgroundTaskStatus,
  clearBackgroundTask,
} from './usecases';

// ============================================
// Test Fixtures
// ============================================

const testEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  accountId: 1,
  folderId: 1,
  uid: 100,
  subject: 'Test Subject',
  from: { address: 'sender@example.com', name: 'Sender' },
  to: ['recipient@example.com'],
  date: new Date('2024-01-15'),
  snippet: 'This is a test email...',
  sizeBytes: 1024,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
};

const testEmail2: Email = {
  ...testEmail,
  id: 2,
  messageId: '<test2@example.com>',
  subject: 'Second Test',
  date: new Date('2024-01-16'), // More recent
};

const testEmail3: Email = {
  ...testEmail,
  id: 3,
  messageId: '<test3@example.com>',
  subject: 'Third Test',
  date: new Date('2024-01-14'), // Older
};

const testBody: EmailBody = {
  text: 'Plain text body',
  html: '<p>HTML body</p>',
};

const testAccount: Account = {
  id: 1,
  name: 'Test Account',
  email: 'test@example.com',
  imapHost: 'imap.example.com',
  imapPort: 993,
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  username: 'test@example.com',
  isActive: true,
  lastSync: null,
};

const testAccount2: Account = {
  ...testAccount,
  id: 2,
  name: 'Second Account',
  email: 'second@example.com',
};

const testTags: Tag[] = [
  { id: 1, name: 'Inbox', slug: 'inbox', color: '#4A90D9', isSystem: true, sortOrder: 0 },
  { id: 2, name: 'Archive', slug: 'archive', color: '#808080', isSystem: true, sortOrder: 1 },
  { id: 3, name: 'Work', slug: 'work', color: '#E74C3C', isSystem: false, sortOrder: 2 },
];

const defaultLLMConfig: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-20250514',
  dailyBudget: 1.0,
  dailyEmailLimit: 50,
  autoClassify: true,
  confidenceThreshold: 0.85,
  reclassifyCooldownDays: 30,
};

// ============================================
// Mock Factories
// ============================================

function createMockEmailRepo(overrides: Partial<EmailRepo> = {}): EmailRepo {
  return {
    findById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    getBody: vi.fn().mockResolvedValue(null),
    saveBody: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(testEmail),
    insertBatch: vi.fn().mockResolvedValue({ count: 0, ids: [] }),
    markRead: vi.fn().mockResolvedValue(undefined),
    setStar: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockTagRepo(overrides: Partial<TagRepo> = {}): TagRepo {
  return {
    findAll: vi.fn().mockResolvedValue(testTags),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByEmailId: vi.fn().mockResolvedValue([]),
    apply: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(testTags[2]),
    ...overrides,
  };
}

function createMockAccountRepo(overrides: Partial<AccountRepo> = {}): AccountRepo {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(testAccount),
    update: vi.fn().mockResolvedValue(testAccount),
    delete: vi.fn().mockResolvedValue(undefined),
    updateLastSync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockSync(overrides: Partial<MailSync> = {}): MailSync {
  return {
    sync: vi.fn().mockResolvedValue({ newCount: 0, newEmailIds: [] }),
    fetchBody: vi.fn().mockResolvedValue(testBody),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn().mockReturnValue(() => {}),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX']),
    listFolders: vi.fn().mockResolvedValue([]),
    appendToSent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockClassifier(overrides: Partial<Classifier> = {}): Classifier {
  return {
    classify: vi.fn().mockResolvedValue({
      suggestedTags: ['work'],
      confidence: 0.9,
      reasoning: 'Contains work-related content',
      priority: 'normal',
    } as Classification),
    getBudget: vi.fn().mockReturnValue({ used: 0, limit: 100, allowed: true }),
    getEmailBudget: vi.fn().mockReturnValue({ used: 0, limit: 50, allowed: true }),
    ...overrides,
  };
}

function createMockSecrets(overrides: Partial<SecureStorage> = {}): SecureStorage {
  return {
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue('secret'),
    deletePassword: vi.fn().mockResolvedValue(true),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    getApiKey: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
    getConfig: vi.fn().mockReturnValue({ biometricMode: 'never', sessionTimeoutMs: 0, requireForSend: false }),
    setConfig: vi.fn(),
    isBiometricAvailable: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function createMockSender(overrides: Partial<MailSender> = {}): MailSender {
  return {
    send: vi.fn().mockResolvedValue({ messageId: '<sent@example.com>', accepted: ['recipient@example.com'], rejected: [] }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<ConfigStore> = {}): ConfigStore {
  return {
    getLLMConfig: vi.fn().mockReturnValue(defaultLLMConfig),
    getRemoteImagesSetting: vi.fn().mockReturnValue('block'),
    setRemoteImagesSetting: vi.fn(),
    ...overrides,
  };
}

function createMockClassificationStateRepo(overrides: Partial<ClassificationStateRepo> = {}): ClassificationStateRepo {
  return {
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),
    listPendingReview: vi.fn().mockResolvedValue([]),
    listByPriority: vi.fn().mockResolvedValue([]),
    listFailed: vi.fn().mockResolvedValue([]),
    countByStatus: vi.fn().mockResolvedValue({ unprocessed: 0, classified: 0, pending_review: 0, accepted: 0, dismissed: 0, error: 0 }),
    listReclassifiable: vi.fn().mockResolvedValue([]),
    logFeedback: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ classifiedToday: 0, pendingReview: 0, accuracy30Day: 0, budgetUsed: 0, budgetLimit: 200, priorityBreakdown: { high: 0, normal: 0, low: 0 } }),
    getAccuracy30Day: vi.fn().mockResolvedValue(0),
    listConfusedPatterns: vi.fn().mockResolvedValue([]),
    updateConfusedPattern: vi.fn().mockResolvedValue(undefined),
    clearConfusedPatterns: vi.fn().mockResolvedValue(undefined),
    listRecentFeedback: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMockLLMProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    type: 'anthropic',
    validateKey: vi.fn().mockResolvedValue({ valid: true }),
    listModels: vi.fn().mockResolvedValue([{ id: 'claude-3', displayName: 'Claude 3' }]),
    testConnection: vi.fn().mockResolvedValue({ connected: true }),
    ...overrides,
  };
}

function createMockBackgroundTaskManager(overrides: Partial<BackgroundTaskManager> = {}): BackgroundTaskManager {
  return {
    start: vi.fn(),
    getStatus: vi.fn().mockReturnValue(null),
    clear: vi.fn(),
    ...overrides,
  };
}

// ============================================
// Email Use Case Tests
// ============================================

describe('listEmails', () => {
  it('delegates to emails.list with options', async () => {
    const emails = createMockEmailRepo({ list: vi.fn().mockResolvedValue([testEmail]) });
    const result = await listEmails({ emails })({ limit: 10, unreadOnly: true });

    expect(emails.list).toHaveBeenCalledWith({ limit: 10, unreadOnly: true });
    expect(result).toEqual([testEmail]);
  });

  it('returns empty array when no emails', async () => {
    const emails = createMockEmailRepo({ list: vi.fn().mockResolvedValue([]) });
    const result = await listEmails({ emails })({});

    expect(result).toEqual([]);
  });
});

describe('getEmail', () => {
  it('returns email when found', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(testEmail) });
    const result = await getEmail({ emails })(1);

    expect(emails.findById).toHaveBeenCalledWith(1);
    expect(result).toEqual(testEmail);
  });

  it('returns null when not found', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(null) });
    const result = await getEmail({ emails })(999);

    expect(result).toBeNull();
  });
});

describe('getEmailBody', () => {
  it('returns cached body when available', async () => {
    const emails = createMockEmailRepo({ getBody: vi.fn().mockResolvedValue(testBody) });
    const accounts = createMockAccountRepo();
    const sync = createMockSync();

    const result = await getEmailBody({ emails, accounts, sync })(1);

    expect(emails.getBody).toHaveBeenCalledWith(1);
    expect(sync.fetchBody).not.toHaveBeenCalled();
    expect(result).toEqual(testBody);
  });

  it('fetches from IMAP and caches when not cached', async () => {
    const emails = createMockEmailRepo({
      getBody: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(testEmail),
      saveBody: vi.fn().mockResolvedValue(undefined),
    });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sync = createMockSync({ fetchBody: vi.fn().mockResolvedValue(testBody) });

    const result = await getEmailBody({ emails, accounts, sync })(1);

    expect(emails.getBody).toHaveBeenCalledWith(1);
    expect(emails.findById).toHaveBeenCalledWith(1);
    expect(accounts.findById).toHaveBeenCalledWith(testEmail.accountId);
    expect(sync.fetchBody).toHaveBeenCalledWith(testAccount, 1);
    expect(emails.saveBody).toHaveBeenCalledWith(1, testBody);
    expect(result).toEqual(testBody);
  });

  it('throws when email not found', async () => {
    const emails = createMockEmailRepo({
      getBody: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    });
    const accounts = createMockAccountRepo();
    const sync = createMockSync();

    await expect(getEmailBody({ emails, accounts, sync })(999)).rejects.toThrow('Email not found');
  });

  it('throws when account not found', async () => {
    const emails = createMockEmailRepo({
      getBody: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(testEmail),
    });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const sync = createMockSync();

    await expect(getEmailBody({ emails, accounts, sync })(1)).rejects.toThrow('Account not found');
  });
});

describe('searchEmails', () => {
  it('delegates to emails.search with query and limit', async () => {
    const emails = createMockEmailRepo({ search: vi.fn().mockResolvedValue([testEmail]) });
    const result = await searchEmails({ emails })('test query', 50);

    expect(emails.search).toHaveBeenCalledWith('test query', 50, undefined);
    expect(result).toEqual([testEmail]);
  });

  it('uses default limit of 100', async () => {
    const emails = createMockEmailRepo({ search: vi.fn().mockResolvedValue([]) });
    await searchEmails({ emails })('query');

    expect(emails.search).toHaveBeenCalledWith('query', 100, undefined);
  });

  it('passes accountId when provided', async () => {
    const emails = createMockEmailRepo({ search: vi.fn().mockResolvedValue([testEmail]) });
    const result = await searchEmails({ emails })('test query', 50, 1);

    expect(emails.search).toHaveBeenCalledWith('test query', 50, 1);
    expect(result).toEqual([testEmail]);
  });
});

describe('markRead', () => {
  it('delegates to emails.markRead', async () => {
    const emails = createMockEmailRepo();
    await markRead({ emails })(1, true);

    expect(emails.markRead).toHaveBeenCalledWith(1, true);
  });

  it('can mark as unread', async () => {
    const emails = createMockEmailRepo();
    await markRead({ emails })(1, false);

    expect(emails.markRead).toHaveBeenCalledWith(1, false);
  });
});

describe('starEmail', () => {
  it('delegates to emails.setStar', async () => {
    const emails = createMockEmailRepo();
    await starEmail({ emails })(1, true);

    expect(emails.setStar).toHaveBeenCalledWith(1, true);
  });

  it('can unstar email', async () => {
    const emails = createMockEmailRepo();
    await starEmail({ emails })(1, false);

    expect(emails.setStar).toHaveBeenCalledWith(1, false);
  });
});

describe('deleteEmail', () => {
  it('delegates to emails.delete', async () => {
    const emails = createMockEmailRepo();
    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn(),
      hasLoadedImages: vi.fn(),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };

    await deleteEmail({ emails, imageCache })(1);

    expect(emails.delete).toHaveBeenCalledWith(1);
  });

  it('clears image cache before deleting email', async () => {
    const emails = createMockEmailRepo();
    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn(),
      hasLoadedImages: vi.fn(),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };

    await deleteEmail({ emails, imageCache })(1);

    expect(imageCache.clearCache).toHaveBeenCalledWith(1);
    expect(emails.delete).toHaveBeenCalledWith(1);
  });
});

// ============================================
// Tag Use Case Tests
// ============================================

describe('archiveEmail', () => {
  it('applies archive tag and removes inbox tag', async () => {
    const tags = createMockTagRepo({
      findBySlug: vi.fn()
        .mockResolvedValueOnce(testTags[1]) // archive
        .mockResolvedValueOnce(testTags[0]), // inbox
    });

    await archiveEmail({ tags })(1);

    expect(tags.findBySlug).toHaveBeenCalledWith('archive');
    expect(tags.findBySlug).toHaveBeenCalledWith('inbox');
    expect(tags.apply).toHaveBeenCalledWith(1, testTags[1].id, 'manual');
    expect(tags.remove).toHaveBeenCalledWith(1, testTags[0].id);
  });

  it('handles missing archive tag gracefully', async () => {
    const tags = createMockTagRepo({
      findBySlug: vi.fn().mockResolvedValue(null),
    });

    await archiveEmail({ tags })(1);

    expect(tags.apply).not.toHaveBeenCalled();
    expect(tags.remove).not.toHaveBeenCalled();
  });
});

describe('listTags', () => {
  it('returns all tags', async () => {
    const tags = createMockTagRepo({ findAll: vi.fn().mockResolvedValue(testTags) });
    const result = await listTags({ tags })();

    expect(result).toEqual(testTags);
  });
});

describe('getEmailTags', () => {
  it('returns tags for email', async () => {
    const appliedTags: AppliedTag[] = [
      { ...testTags[0], source: 'manual', confidence: null },
      { ...testTags[2], source: 'llm', confidence: 0.9 },
    ];
    const tags = createMockTagRepo({ findByEmailId: vi.fn().mockResolvedValue(appliedTags) });

    const result = await getEmailTags({ tags })(1);

    expect(tags.findByEmailId).toHaveBeenCalledWith(1);
    expect(result).toEqual(appliedTags);
  });

  it('returns empty array when no tags', async () => {
    const tags = createMockTagRepo({ findByEmailId: vi.fn().mockResolvedValue([]) });

    const result = await getEmailTags({ tags })(1);

    expect(result).toEqual([]);
  });
});

describe('applyTag', () => {
  it('applies tag with source and confidence', async () => {
    const tags = createMockTagRepo();
    await applyTag({ tags })(1, 3, 'llm', 0.95);

    expect(tags.apply).toHaveBeenCalledWith(1, 3, 'llm', 0.95);
  });

  it('uses manual as default source', async () => {
    const tags = createMockTagRepo();
    await applyTag({ tags })(1, 3);

    expect(tags.apply).toHaveBeenCalledWith(1, 3, 'manual', undefined);
  });
});

describe('removeTag', () => {
  it('delegates to tags.remove', async () => {
    const tags = createMockTagRepo();
    await removeTag({ tags })(1, 3);

    expect(tags.remove).toHaveBeenCalledWith(1, 3);
  });
});

describe('createTag', () => {
  it('creates new tag', async () => {
    const newTag = { name: 'Personal', slug: 'personal', color: '#00FF00', isSystem: false, sortOrder: 3 };
    const createdTag = { id: 4, ...newTag };
    const tags = createMockTagRepo({ create: vi.fn().mockResolvedValue(createdTag) });

    const result = await createTag({ tags })(newTag);

    expect(tags.create).toHaveBeenCalledWith(newTag);
    expect(result).toEqual(createdTag);
  });
});

// ============================================
// Sync Use Case Tests
// ============================================

describe('syncMailbox', () => {
  it('syncs account and updates lastSync', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sync = createMockSync({ sync: vi.fn().mockResolvedValue({ newCount: 5, newEmailIds: [1, 2, 3, 4, 5] }) });

    const result = await syncMailbox({ accounts, sync })(1, { folder: 'INBOX' });

    expect(accounts.findById).toHaveBeenCalledWith(1);
    expect(sync.sync).toHaveBeenCalledWith(testAccount, { folder: 'INBOX' });
    expect(accounts.updateLastSync).toHaveBeenCalledWith(1);
    expect(result).toEqual({ newCount: 5, newEmailIds: [1, 2, 3, 4, 5] });
  });

  it('throws when account not found', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const sync = createMockSync();

    await expect(syncMailbox({ accounts, sync })(999)).rejects.toThrow('Account not found');
    expect(sync.sync).not.toHaveBeenCalled();
  });
});

describe('syncAllMailboxes', () => {
  it('syncs all accounts across default folders', async () => {
    const accounts = createMockAccountRepo({ findAll: vi.fn().mockResolvedValue([testAccount, testAccount2]) });
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 2, newEmailIds: [1, 2] }),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX', 'Sent']),
    });

    const result = await syncAllMailboxes({ accounts, sync })({});

    expect(accounts.findAll).toHaveBeenCalled();
    expect(sync.getDefaultFolders).toHaveBeenCalled();
    // 2 accounts × 2 folders = 4 sync calls
    expect(sync.sync).toHaveBeenCalledTimes(4);
    expect(accounts.updateLastSync).toHaveBeenCalledWith(1);
    expect(accounts.updateLastSync).toHaveBeenCalledWith(2);
    // 4 syncs × 2 emails each = 8 total
    expect(result.newCount).toBe(8);
    expect(result.newEmailIds).toHaveLength(8);
  });

  it('uses provided folders instead of defaults', async () => {
    const accounts = createMockAccountRepo({ findAll: vi.fn().mockResolvedValue([testAccount]) });
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 1, newEmailIds: [1] }),
    });

    await syncAllMailboxes({ accounts, sync })({ folders: ['INBOX'] });

    expect(sync.getDefaultFolders).not.toHaveBeenCalled();
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(sync.sync).toHaveBeenCalledWith(testAccount, { folders: ['INBOX'], folder: 'INBOX' });
  });

  it('continues on NONEXISTENT folder errors', async () => {
    const accounts = createMockAccountRepo({ findAll: vi.fn().mockResolvedValue([testAccount]) });
    const sync = createMockSync({
      sync: vi.fn()
        .mockResolvedValueOnce({ newCount: 1, newEmailIds: [1] })
        .mockRejectedValueOnce(new Error('Mailbox does not exist')),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX', 'Sent']),
    });

    const result = await syncAllMailboxes({ accounts, sync })({});

    expect(result.newCount).toBe(1);
  });
});

describe('syncWithAutoClassify', () => {
  it('syncs and classifies new emails when autoClassify enabled', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sync = createMockSync({ sync: vi.fn().mockResolvedValue({ newCount: 2, newEmailIds: [1, 2] }) });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig();

    const result = await syncWithAutoClassify({ accounts, sync, emails, tags, classifier, classificationState, config })(1);

    expect(result.newCount).toBe(2);
    expect(classifier.classify).toHaveBeenCalled();
  });

  it('skips classification when autoClassify disabled', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sync = createMockSync({ sync: vi.fn().mockResolvedValue({ newCount: 2, newEmailIds: [1, 2] }) });
    const emails = createMockEmailRepo();
    const tags = createMockTagRepo();
    const classifier = createMockClassifier();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig({
      getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, autoClassify: false }),
    });

    const result = await syncWithAutoClassify({ accounts, sync, emails, tags, classifier, classificationState, config })(1);

    expect(result.newCount).toBe(2);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('skips classification when no new emails', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sync = createMockSync({ sync: vi.fn().mockResolvedValue({ newCount: 0, newEmailIds: [] }) });
    const emails = createMockEmailRepo();
    const tags = createMockTagRepo();
    const classifier = createMockClassifier();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig();

    await syncWithAutoClassify({ accounts, sync, emails, tags, classifier, classificationState, config })(1);

    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

describe('syncAllWithAutoClassify', () => {
  it('syncs all and classifies when enabled', async () => {
    const accounts = createMockAccountRepo({ findAll: vi.fn().mockResolvedValue([testAccount]) });
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 1, newEmailIds: [1] }),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX']),
    });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig();

    const result = await syncAllWithAutoClassify({ accounts, sync, emails, tags, classifier, classificationState, config })({});

    expect(result.newCount).toBe(1);
    expect(classifier.classify).toHaveBeenCalled();
  });
});

// ============================================
// Classification Use Case Tests
// ============================================

describe('classifyEmail', () => {
  it('classifies email with body and existing tags', async () => {
    const existingTags: AppliedTag[] = [{ ...testTags[0], source: 'manual', confidence: null }];
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({ findByEmailId: vi.fn().mockResolvedValue(existingTags) });
    const classifier = createMockClassifier();

    const result = await classifyEmail({ emails, tags, classifier })(1);

    expect(classifier.classify).toHaveBeenCalledWith(testEmail, testBody, ['inbox']);
    expect(result.suggestedTags).toContain('work');
  });

  it('classifies without body if not available', async () => {
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(null),
    });
    const tags = createMockTagRepo({ findByEmailId: vi.fn().mockResolvedValue([]) });
    const classifier = createMockClassifier();

    await classifyEmail({ emails, tags, classifier })(1);

    expect(classifier.classify).toHaveBeenCalledWith(testEmail, undefined, []);
  });

  it('throws when email not found', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(null) });
    const tags = createMockTagRepo();
    const classifier = createMockClassifier();

    await expect(classifyEmail({ emails, tags, classifier })(999)).rejects.toThrow('Email not found');
  });
});

describe('classifyAndApply', () => {
  it('applies tags when confidence exceeds threshold', async () => {
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier({
      classify: vi.fn().mockResolvedValue({
        suggestedTags: ['work'],
        confidence: 0.9,
        reasoning: 'Work related',
        priority: 'normal',
      } as Classification),
    });
    const classificationState = createMockClassificationStateRepo();

    await classifyAndApply({ emails, tags, classifier, classificationState })(1, 0.85);

    expect(tags.apply).toHaveBeenCalledWith(1, testTags[2].id, 'llm', 0.9);
    expect(classificationState.setState).toHaveBeenCalledWith(expect.objectContaining({
      emailId: 1,
      status: 'classified',
      confidence: 0.9,
    }));
  });

  it('does not apply tags when confidence below threshold', async () => {
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({ findByEmailId: vi.fn().mockResolvedValue([]) });
    const classifier = createMockClassifier({
      classify: vi.fn().mockResolvedValue({
        suggestedTags: ['work'],
        confidence: 0.5,
        reasoning: 'Maybe work related',
        priority: 'normal',
      } as Classification),
    });
    const classificationState = createMockClassificationStateRepo();

    await classifyAndApply({ emails, tags, classifier, classificationState })(1, 0.85);

    expect(tags.apply).not.toHaveBeenCalled();
    expect(classificationState.setState).toHaveBeenCalledWith(expect.objectContaining({
      emailId: 1,
      status: 'pending_review',
      confidence: 0.5,
    }));
  });

  it('ignores unknown tag slugs', async () => {
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier({
      classify: vi.fn().mockResolvedValue({
        suggestedTags: ['nonexistent-tag'],
        confidence: 0.95,
        reasoning: 'Test',
        priority: 'normal',
      } as Classification),
    });
    const classificationState = createMockClassificationStateRepo();

    await classifyAndApply({ emails, tags, classifier, classificationState })(1, 0.85);

    expect(tags.apply).not.toHaveBeenCalled();
  });
});

describe('classifyNewEmails', () => {
  it('classifies emails sorted by date (most recent first)', async () => {
    const classifyOrder: number[] = [];
    const emails = createMockEmailRepo({
      findById: vi.fn().mockImplementation((id: number) => {
        classifyOrder.push(id);
        if (id === 1) return Promise.resolve(testEmail);
        if (id === 2) return Promise.resolve(testEmail2);
        if (id === 3) return Promise.resolve(testEmail3);
        return Promise.resolve(null);
      }),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier();
    const classificationState = createMockClassificationStateRepo();

    await classifyNewEmails({ emails, tags, classifier, classificationState })([1, 2, 3], 0.85);

    // First call is to fetch all emails for sorting, then classify calls
    // testEmail2 (Jan 16) should be classified before testEmail (Jan 15) before testEmail3 (Jan 14)
    expect(classifier.classify).toHaveBeenCalledTimes(3);
  });

  it('respects daily email budget limit', async () => {
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier({
      getEmailBudget: vi.fn().mockReturnValue({ used: 48, limit: 50, allowed: true }), // Only 2 remaining
    });
    const classificationState = createMockClassificationStateRepo();

    const result = await classifyNewEmails({ emails, tags, classifier, classificationState })([1, 2, 3, 4, 5], 0.85);

    expect(result.classified).toBeLessThanOrEqual(2);
    expect(result.skipped).toBeGreaterThanOrEqual(3);
  });

  it('returns early when budget exhausted', async () => {
    const emails = createMockEmailRepo();
    const tags = createMockTagRepo();
    const classifier = createMockClassifier({
      getEmailBudget: vi.fn().mockReturnValue({ used: 50, limit: 50, allowed: false }),
    });
    const classificationState = createMockClassificationStateRepo();

    const result = await classifyNewEmails({ emails, tags, classifier, classificationState })([1, 2, 3], 0.85);

    expect(result.classified).toBe(0);
    expect(result.skipped).toBe(3);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('continues on individual classification errors', async () => {
    let callCount = 0;
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo({
      findByEmailId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue(testTags),
    });
    const classifier = createMockClassifier({
      classify: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('API error'));
        return Promise.resolve({
          suggestedTags: ['work'],
          confidence: 0.9,
          reasoning: 'Work',
          priority: 'normal',
        } as Classification);
      }),
    });
    const classificationState = createMockClassificationStateRepo();

    const result = await classifyNewEmails({ emails, tags, classifier, classificationState })([1, 2], 0.85);

    expect(classifier.classify).toHaveBeenCalledTimes(2);
    expect(result.classified).toBe(1); // One succeeded
  });
});

// ============================================
// Account Use Case Tests
// ============================================

describe('listAccounts', () => {
  it('returns all accounts', async () => {
    const accounts = createMockAccountRepo({ findAll: vi.fn().mockResolvedValue([testAccount, testAccount2]) });
    const result = await listAccounts({ accounts })();

    expect(result).toEqual([testAccount, testAccount2]);
  });

  it('returns empty array when no accounts', async () => {
    const accounts = createMockAccountRepo({ findAll: vi.fn().mockResolvedValue([]) });
    const result = await listAccounts({ accounts })();

    expect(result).toEqual([]);
  });
});

describe('getAccount', () => {
  it('returns account when found', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const result = await getAccount({ accounts })(1);

    expect(accounts.findById).toHaveBeenCalledWith(1);
    expect(result).toEqual(testAccount);
  });

  it('returns null when not found', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const result = await getAccount({ accounts })(999);

    expect(result).toBeNull();
  });
});

describe('createAccount', () => {
  const accountInput = {
    name: 'New Account',
    email: 'new@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    username: 'new@example.com',
  };

  it('creates account and stores password', async () => {
    const accounts = createMockAccountRepo();
    const secrets = createMockSecrets();

    await createAccount({ accounts, secrets })(accountInput, 'password123');

    expect(accounts.findByEmail).toHaveBeenCalledWith('new@example.com');
    expect(secrets.setPassword).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(accounts.create).toHaveBeenCalledWith(accountInput);
  });

  it('throws when account already exists', async () => {
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(testAccount),
    });
    const secrets = createMockSecrets();

    await expect(createAccount({ accounts, secrets })(accountInput, 'password123'))
      .rejects.toThrow('Account already exists');

    expect(secrets.setPassword).not.toHaveBeenCalled();
    expect(accounts.create).not.toHaveBeenCalled();
  });
});

describe('updateAccount', () => {
  it('updates account without password change', async () => {
    const updatedAccount = { ...testAccount, name: 'Updated Name' };
    const accounts = createMockAccountRepo({
      findById: vi.fn().mockResolvedValue(testAccount),
      update: vi.fn().mockResolvedValue(updatedAccount),
    });
    const secrets = createMockSecrets();

    const result = await updateAccount({ accounts, secrets })(1, { name: 'Updated Name' });

    expect(accounts.findById).toHaveBeenCalledWith(1);
    expect(secrets.setPassword).not.toHaveBeenCalled();
    expect(accounts.update).toHaveBeenCalledWith(1, { name: 'Updated Name' });
    expect(result.name).toBe('Updated Name');
  });

  it('updates password when provided', async () => {
    const accounts = createMockAccountRepo({
      findById: vi.fn().mockResolvedValue(testAccount),
      update: vi.fn().mockResolvedValue(testAccount),
    });
    const secrets = createMockSecrets();

    await updateAccount({ accounts, secrets })(1, {}, 'newpassword');

    expect(secrets.setPassword).toHaveBeenCalledWith('test@example.com', 'newpassword');
  });

  it('throws when account not found', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const secrets = createMockSecrets();

    await expect(updateAccount({ accounts, secrets })(999, { name: 'Test' }))
      .rejects.toThrow('Account not found');
  });
});

describe('deleteAccount', () => {
  it('disconnects, deletes password, and deletes account', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await deleteAccount({ accounts, secrets, sync })(1);

    expect(accounts.findById).toHaveBeenCalledWith(1);
    expect(sync.disconnect).toHaveBeenCalledWith(1);
    expect(secrets.deletePassword).toHaveBeenCalledWith('test@example.com');
    expect(accounts.delete).toHaveBeenCalledWith(1);
  });

  it('throws when account not found', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await expect(deleteAccount({ accounts, secrets, sync })(999))
      .rejects.toThrow('Account not found');

    expect(sync.disconnect).not.toHaveBeenCalled();
    expect(secrets.deletePassword).not.toHaveBeenCalled();
    expect(accounts.delete).not.toHaveBeenCalled();
  });
});

describe('testImapConnection', () => {
  it('tests connection with stored password', async () => {
    const sync = createMockSync({ testConnection: vi.fn().mockResolvedValue({ ok: true }) });
    const secrets = createMockSecrets({ getPassword: vi.fn().mockResolvedValue('stored-password') });

    const result = await testImapConnection({ sync, secrets })('test@example.com', 'imap.example.com', 993);

    expect(secrets.getPassword).toHaveBeenCalledWith('test@example.com');
    expect(sync.testConnection).toHaveBeenCalledWith('imap.example.com', 993, 'test@example.com', 'stored-password');
    expect(result.ok).toBe(true);
  });

  it('returns error when no password stored', async () => {
    const sync = createMockSync();
    const secrets = createMockSecrets({ getPassword: vi.fn().mockResolvedValue(null) });

    const result = await testImapConnection({ sync, secrets })('test@example.com', 'imap.example.com', 993);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No password stored for this account');
    expect(sync.testConnection).not.toHaveBeenCalled();
  });

  it('returns connection error', async () => {
    const sync = createMockSync({
      testConnection: vi.fn().mockResolvedValue({ ok: false, error: 'Connection refused' }),
    });
    const secrets = createMockSecrets();

    const result = await testImapConnection({ sync, secrets })('test@example.com', 'imap.example.com', 993);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection refused');
  });
});

describe('testSmtpConnection', () => {
  it('delegates to sender.testConnection', async () => {
    const sender = createMockSender({ testConnection: vi.fn().mockResolvedValue({ ok: true }) });
    const smtpConfig: SmtpConfig = { host: 'smtp.example.com', port: 465, secure: true };

    const result = await testSmtpConnection({ sender })('test@example.com', smtpConfig);

    expect(sender.testConnection).toHaveBeenCalledWith(smtpConfig, 'test@example.com');
    expect(result.ok).toBe(true);
  });
});

// ============================================
// Send Use Case Tests
// ============================================

describe('sendEmail', () => {
  const draft = {
    to: ['recipient@example.com'],
    subject: 'Test Subject',
    text: 'Test body',
  };

  it('sends email via SMTP', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    const result = await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    expect(accounts.findById).toHaveBeenCalledWith(1);
    expect(sender.send).toHaveBeenCalledWith(
      'test@example.com',
      { host: 'smtp.example.com', port: 465, secure: true },
      draft
    );
    expect(result.messageId).toBe('<sent@example.com>');
  });

  it('uses secure=true for port 465', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    expect(sender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secure: true, port: 465 }),
      expect.anything()
    );
  });

  it('uses secure=false for other ports', async () => {
    const accountPort587 = { ...testAccount, smtpPort: 587 };
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(accountPort587) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    expect(sender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secure: false, port: 587 }),
      expect.anything()
    );
  });

  it('checks biometric when requireForSend is true', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets({
      getConfig: vi.fn().mockReturnValue({ biometricMode: 'always', sessionTimeoutMs: 0, requireForSend: true }),
      getPassword: vi.fn().mockResolvedValue('password'),
    });
    const sync = createMockSync();

    await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    expect(secrets.getPassword).toHaveBeenCalledWith('test@example.com');
  });

  it('throws when biometric required but no password', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets({
      getConfig: vi.fn().mockReturnValue({ biometricMode: 'always', sessionTimeoutMs: 0, requireForSend: true }),
      getPassword: vi.fn().mockResolvedValue(null),
    });
    const sync = createMockSync();

    await expect(sendEmail({ accounts, sender, secrets, sync })(1, draft))
      .rejects.toThrow('Authentication required');
  });

  it('throws when account not found', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await expect(sendEmail({ accounts, sender, secrets, sync })(999, draft))
      .rejects.toThrow('Account not found');
  });

  it('appends sent email to Sent folder via IMAP after SMTP send', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync({
      appendToSent: vi.fn().mockResolvedValue(undefined),
      getDefaultFolders: vi.fn().mockReturnValue(['INBOX', 'Sent']),
    });

    await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    expect(sender.send).toHaveBeenCalled();
    expect(sync.appendToSent).toHaveBeenCalledWith(
      testAccount,
      expect.objectContaining({
        from: testAccount.email,
        to: draft.to,
        subject: draft.subject,
        text: draft.text,
      })
    );
  });

  it('uses provider-specific Sent folder path', async () => {
    const gmailAccount = { ...testAccount, imapHost: 'imap.gmail.com' };
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(gmailAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync({
      appendToSent: vi.fn().mockResolvedValue(undefined),
      getDefaultFolders: vi.fn().mockReturnValue(['INBOX', '[Gmail]/Sent Mail']),
    });

    await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    // appendToSent should use the provider-specific sent folder from getDefaultFolders
    expect(sync.appendToSent).toHaveBeenCalledWith(
      gmailAccount,
      expect.any(Object)
    );
  });

  it('still succeeds if appendToSent fails (best effort)', async () => {
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync({
      appendToSent: vi.fn().mockRejectedValue(new Error('IMAP connection failed')),
    });

    // Should not throw - SMTP send succeeded, append failure is logged but not fatal
    const result = await sendEmail({ accounts, sender, secrets, sync })(1, draft);

    expect(result.messageId).toBe('<sent@example.com>');
    expect(sync.appendToSent).toHaveBeenCalled();
  });
});

describe('replyToEmail', () => {
  it('builds reply with Re: prefix and inReplyTo', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(testEmail) });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await replyToEmail({ emails, accounts, sender, secrets, sync })(1, { text: 'Reply text' });

    expect(sender.send).toHaveBeenCalledWith(
      'test@example.com',
      expect.anything(),
      expect.objectContaining({
        to: ['sender@example.com'],
        subject: 'Re: Test Subject',
        text: 'Reply text',
        inReplyTo: '<test@example.com>',
        references: ['<test@example.com>'],
      })
    );
  });

  it('does not double Re: prefix', async () => {
    const emailWithRe = { ...testEmail, subject: 'Re: Already has prefix' };
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(emailWithRe) });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await replyToEmail({ emails, accounts, sender, secrets, sync })(1, { text: 'Reply' });

    expect(sender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ subject: 'Re: Already has prefix' })
    );
  });

  it('includes CC recipients on reply-all', async () => {
    const emailWithMultipleRecipients = {
      ...testEmail,
      to: ['recipient@example.com', 'other@example.com', 'test@example.com'], // includes account email
    };
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(emailWithMultipleRecipients) });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await replyToEmail({ emails, accounts, sender, secrets, sync })(1, { text: 'Reply all' }, true);

    expect(sender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        to: ['sender@example.com'],
        cc: ['recipient@example.com', 'other@example.com'], // excludes own email
      })
    );
  });

  it('throws when email not found', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(null) });
    const accounts = createMockAccountRepo();
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await expect(replyToEmail({ emails, accounts, sender, secrets, sync })(999, { text: 'Reply' }))
      .rejects.toThrow('Email not found');
  });

  it('throws when account not found', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(testEmail) });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(null) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await expect(replyToEmail({ emails, accounts, sender, secrets, sync })(1, { text: 'Reply' }))
      .rejects.toThrow('Account not found');
  });
});

describe('forwardEmail', () => {
  it('builds forward with Fwd: prefix', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(testEmail) });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await forwardEmail({ emails, accounts, sender, secrets, sync })(1, ['forward@example.com'], { text: 'FYI' });

    expect(sender.send).toHaveBeenCalledWith(
      'test@example.com',
      expect.anything(),
      expect.objectContaining({
        to: ['forward@example.com'],
        subject: 'Fwd: Test Subject',
        text: 'FYI',
      })
    );
  });

  it('does not double Fwd: prefix', async () => {
    const emailWithFwd = { ...testEmail, subject: 'Fwd: Already forwarded' };
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(emailWithFwd) });
    const accounts = createMockAccountRepo({ findById: vi.fn().mockResolvedValue(testAccount) });
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await forwardEmail({ emails, accounts, sender, secrets, sync })(1, ['forward@example.com'], { text: 'FYI' });

    expect(sender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ subject: 'Fwd: Already forwarded' })
    );
  });

  it('throws when email not found', async () => {
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(null) });
    const accounts = createMockAccountRepo();
    const sender = createMockSender();
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await expect(forwardEmail({ emails, accounts, sender, secrets, sync })(999, ['test@example.com'], { text: 'FYI' }))
      .rejects.toThrow('Email not found');
  });
});

// ============================================
// Add Account Use Case Tests
// ============================================

// ============================================
// Remote Images Use Case Tests
// ============================================

describe('loadRemoteImages', () => {
  it('fetches and caches remote images for an email', async () => {
    const imageUrls = ['https://example.com/image1.jpg', 'https://example.com/image2.png'];
    const cachedImages = [
      { url: imageUrls[0], localPath: '/cache/abc123.jpg' },
      { url: imageUrls[1], localPath: '/cache/def456.png' },
    ];

    const imageCache = {
      cacheImages: vi.fn().mockResolvedValue(cachedImages),
      getCachedImages: vi.fn().mockResolvedValue([]),
      hasLoadedImages: vi.fn().mockResolvedValue(false),
      markImagesLoaded: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(testEmail) });

    const result = await loadRemoteImages({ emails, imageCache })(1, imageUrls);

    expect(imageCache.cacheImages).toHaveBeenCalledWith(1, imageUrls);
    expect(imageCache.markImagesLoaded).toHaveBeenCalledWith(1);
    expect(result).toEqual(cachedImages);
  });

  it('returns cached images if already loaded', async () => {
    const imageUrls = ['https://example.com/image1.jpg'];
    const cachedImages = [{ url: imageUrls[0], localPath: '/cache/abc123.jpg' }];

    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn().mockResolvedValue(cachedImages),
      hasLoadedImages: vi.fn().mockResolvedValue(true),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(testEmail) });

    const result = await loadRemoteImages({ emails, imageCache })(1, imageUrls);

    expect(imageCache.hasLoadedImages).toHaveBeenCalledWith(1);
    expect(imageCache.getCachedImages).toHaveBeenCalledWith(1);
    expect(imageCache.cacheImages).not.toHaveBeenCalled();
    expect(result).toEqual(cachedImages);
  });

  it('throws when email not found', async () => {
    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn(),
      hasLoadedImages: vi.fn(),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };
    const emails = createMockEmailRepo({ findById: vi.fn().mockResolvedValue(null) });

    await expect(loadRemoteImages({ emails, imageCache })(999, ['https://example.com/img.jpg']))
      .rejects.toThrow('Email not found');
  });
});

describe('hasLoadedRemoteImages', () => {
  it('returns true when images have been loaded for email', async () => {
    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn(),
      hasLoadedImages: vi.fn().mockResolvedValue(true),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };

    const result = await hasLoadedRemoteImages({ imageCache })(1);

    expect(imageCache.hasLoadedImages).toHaveBeenCalledWith(1);
    expect(result).toBe(true);
  });

  it('returns false when images have not been loaded', async () => {
    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn(),
      hasLoadedImages: vi.fn().mockResolvedValue(false),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };

    const result = await hasLoadedRemoteImages({ imageCache })(1);

    expect(result).toBe(false);
  });
});

describe('getRemoteImagesSetting', () => {
  it('returns current remote images setting', () => {
    const config = {
      getLLMConfig: vi.fn(),
      getRemoteImagesSetting: vi.fn().mockReturnValue('block'),
      setRemoteImagesSetting: vi.fn(),
    };

    const result = getRemoteImagesSetting({ config })();

    expect(config.getRemoteImagesSetting).toHaveBeenCalled();
    expect(result).toBe('block');
  });
});

describe('setRemoteImagesSetting', () => {
  it('updates remote images setting', () => {
    const config = {
      getLLMConfig: vi.fn(),
      getRemoteImagesSetting: vi.fn(),
      setRemoteImagesSetting: vi.fn(),
    };

    setRemoteImagesSetting({ config })('allow');

    expect(config.setRemoteImagesSetting).toHaveBeenCalledWith('allow');
  });
});

describe('clearImageCache', () => {
  it('delegates to imageCache.clearCache', async () => {
    const imageCache = {
      cacheImages: vi.fn(),
      getCachedImages: vi.fn(),
      hasLoadedImages: vi.fn(),
      markImagesLoaded: vi.fn(),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearAllCache: vi.fn().mockResolvedValue(undefined),
    };

    await clearImageCache({ imageCache })(1);

    expect(imageCache.clearCache).toHaveBeenCalledWith(1);
  });
});

describe('addAccount', () => {
  const accountInput = {
    name: 'New Account',
    email: 'new@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    username: 'new@example.com',
  };

  it('creates account and performs initial sync with 30-day since filter', async () => {
    const createdAccount = { ...testAccount, id: 5, email: 'new@example.com' };
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAccount),
      findById: vi.fn().mockResolvedValue(createdAccount),
    });
    const secrets = createMockSecrets();
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 100, newEmailIds: Array.from({ length: 100 }, (_, i) => i + 1) }),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX']),
    });

    const result = await addAccount({ accounts, secrets, sync })(accountInput, 'password123');

    expect(accounts.create).toHaveBeenCalledWith(accountInput);
    expect(secrets.setPassword).toHaveBeenCalledWith('new@example.com', 'password123');
    // Should use since date (30 days ago) instead of maxMessages
    expect(sync.sync).toHaveBeenCalledWith(createdAccount, expect.objectContaining({
      since: expect.any(Date),
    }));
    // Verify the since date is approximately 30 days ago
    const callArgs = (sync.sync as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const expectedDate = new Date(Date.now() - thirtyDaysMs);
    expect(callArgs.since.getTime()).toBeCloseTo(expectedDate.getTime(), -4); // within ~10 seconds
    expect(result.account).toEqual(createdAccount);
    expect(result.syncResult.newCount).toBe(100);
  });

  it('throws when account already exists without syncing', async () => {
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(testAccount),
    });
    const secrets = createMockSecrets();
    const sync = createMockSync();

    await expect(addAccount({ accounts, secrets, sync })(accountInput, 'password123'))
      .rejects.toThrow('Account already exists');

    expect(sync.sync).not.toHaveBeenCalled();
  });

  it('syncs all default folders with 30-day since filter', async () => {
    const createdAccount = { ...testAccount, id: 5, email: 'new@example.com' };
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAccount),
      findById: vi.fn().mockResolvedValue(createdAccount),
    });
    const secrets = createMockSecrets();
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 50, newEmailIds: [1, 2, 3] }),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX', 'Sent']),
    });

    await addAccount({ accounts, secrets, sync })(accountInput, 'password123');

    // Should sync each default folder with since date (30 days ago)
    expect(sync.sync).toHaveBeenCalledTimes(2);
    expect(sync.sync).toHaveBeenCalledWith(createdAccount, expect.objectContaining({ folder: 'INBOX', since: expect.any(Date) }));
    expect(sync.sync).toHaveBeenCalledWith(createdAccount, expect.objectContaining({ folder: 'Sent', since: expect.any(Date) }));
  });

  it('skips initial sync when skipSync is true', async () => {
    const createdAccount = { ...testAccount, id: 5, email: 'new@example.com' };
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAccount),
    });
    const secrets = createMockSecrets();
    const sync = createMockSync();

    const result = await addAccount({ accounts, secrets, sync })(accountInput, 'password123', { skipSync: true });

    expect(accounts.create).toHaveBeenCalledWith(accountInput);
    expect(secrets.setPassword).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(sync.sync).not.toHaveBeenCalled();
    expect(result.account).toEqual(createdAccount);
    expect(result.syncResult.newCount).toBe(0);
    expect(result.syncResult.newEmailIds).toEqual([]);
  });

  it('performs sync by default when skipSync is not provided', async () => {
    const createdAccount = { ...testAccount, id: 5, email: 'new@example.com' };
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAccount),
    });
    const secrets = createMockSecrets();
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 50, newEmailIds: [1, 2, 3] }),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX']),
    });

    const result = await addAccount({ accounts, secrets, sync })(accountInput, 'password123');

    expect(sync.sync).toHaveBeenCalled();
    expect(result.syncResult.newCount).toBe(50);
  });

  it('includes syncDays in result for UI display', async () => {
    const createdAccount = { ...testAccount, id: 5, email: 'new@example.com' };
    const accounts = createMockAccountRepo({
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(createdAccount),
    });
    const secrets = createMockSecrets();
    const sync = createMockSync({
      sync: vi.fn().mockResolvedValue({ newCount: 500, newEmailIds: Array.from({ length: 500 }, (_, i) => i + 1) }),
      getDefaultFolders: vi.fn().mockImplementation(() => ['INBOX']),
    });

    const result = await addAccount({ accounts, secrets, sync })(accountInput, 'password123');

    // Result should include syncDays so UI can show "Downloaded emails from the last 30 days"
    expect(result.syncDays).toBe(30);
  });
});

// ============================================
// Draft Use Case Tests
// ============================================

import type { Draft, DraftInput } from './domain';
import type { DraftRepo } from './ports';
import {
  saveDraft,
  getDraft,
  listDrafts,
  deleteDraft,
} from './usecases';

const testDraftAttachment = {
  id: 1,
  draftId: 1,
  filename: 'document.pdf',
  contentType: 'application/pdf',
  size: 1024,
  content: 'base64encodedcontent',
};

const testDraft: Draft = {
  id: 1,
  accountId: 1,
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Draft Subject',
  text: 'Draft body text',
  html: '<p>Draft body html</p>',
  savedAt: new Date('2024-01-15T10:00:00Z'),
  inReplyTo: null,
  references: [],
  originalEmailId: null,
  attachments: [],
};

const testDraftWithAttachment: Draft = {
  ...testDraft,
  id: 3,
  attachments: [testDraftAttachment],
};

const testDraft2: Draft = {
  ...testDraft,
  id: 2,
  subject: 'Second Draft',
  savedAt: new Date('2024-01-16T10:00:00Z'),
};

function createMockDraftRepo(overrides: Partial<DraftRepo> = {}): DraftRepo {
  return {
    findById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(testDraft),
    update: vi.fn().mockResolvedValue(testDraft),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('saveDraft', () => {
  const draftInput: DraftInput = {
    accountId: 1,
    to: ['recipient@example.com'],
    subject: 'New Draft',
    text: 'Draft content',
  };

  it('saves a new draft', async () => {
    const drafts = createMockDraftRepo({ save: vi.fn().mockResolvedValue({ ...testDraft, ...draftInput }) });

    const result = await saveDraft({ drafts })(draftInput);

    expect(drafts.save).toHaveBeenCalledWith(expect.objectContaining(draftInput));
    expect(result.subject).toBe('New Draft');
  });

  it('updates existing draft when id provided', async () => {
    const existingDraft = { ...testDraft, id: 5 };
    const drafts = createMockDraftRepo({
      findById: vi.fn().mockResolvedValue(existingDraft),
      update: vi.fn().mockResolvedValue({ ...existingDraft, subject: 'Updated Subject' }),
    });

    const result = await saveDraft({ drafts })({ ...draftInput, id: 5, subject: 'Updated Subject' });

    expect(drafts.update).toHaveBeenCalledWith(5, expect.objectContaining({ subject: 'Updated Subject' }));
    expect(result.subject).toBe('Updated Subject');
  });

  it('creates new draft if id provided but draft not found', async () => {
    const drafts = createMockDraftRepo({
      findById: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ ...testDraft, ...draftInput }),
    });

    await saveDraft({ drafts })({ ...draftInput, id: 999 });

    expect(drafts.save).toHaveBeenCalled();
  });
});

describe('getDraft', () => {
  it('returns draft when found', async () => {
    const drafts = createMockDraftRepo({ findById: vi.fn().mockResolvedValue(testDraft) });

    const result = await getDraft({ drafts })(1);

    expect(drafts.findById).toHaveBeenCalledWith(1);
    expect(result).toEqual(testDraft);
  });

  it('returns null when not found', async () => {
    const drafts = createMockDraftRepo({ findById: vi.fn().mockResolvedValue(null) });

    const result = await getDraft({ drafts })(999);

    expect(result).toBeNull();
  });
});

describe('listDrafts', () => {
  it('returns all drafts', async () => {
    const drafts = createMockDraftRepo({ list: vi.fn().mockResolvedValue([testDraft, testDraft2]) });

    const result = await listDrafts({ drafts })();

    expect(drafts.list).toHaveBeenCalledWith({});
    expect(result).toEqual([testDraft, testDraft2]);
  });

  it('filters by accountId when provided', async () => {
    const drafts = createMockDraftRepo({ list: vi.fn().mockResolvedValue([testDraft]) });

    const result = await listDrafts({ drafts })({ accountId: 1 });

    expect(drafts.list).toHaveBeenCalledWith({ accountId: 1 });
    expect(result).toEqual([testDraft]);
  });

  it('returns empty array when no drafts', async () => {
    const drafts = createMockDraftRepo({ list: vi.fn().mockResolvedValue([]) });

    const result = await listDrafts({ drafts })();

    expect(result).toEqual([]);
  });
});

describe('deleteDraft', () => {
  it('deletes draft by id', async () => {
    const drafts = createMockDraftRepo();

    await deleteDraft({ drafts })(1);

    expect(drafts.delete).toHaveBeenCalledWith(1);
  });
});

describe('draft attachments', () => {
  const attachmentInput = {
    filename: 'report.pdf',
    contentType: 'application/pdf',
    size: 2048,
    content: 'SGVsbG8gV29ybGQ=', // base64 "Hello World"
  };

  it('saves draft with attachments', async () => {
    const savedDraft = {
      ...testDraft,
      attachments: [{ ...attachmentInput, id: 1, draftId: 1 }],
    };
    const drafts = createMockDraftRepo({
      save: vi.fn().mockResolvedValue(savedDraft),
    });

    const result = await saveDraft({ drafts })({
      accountId: 1,
      subject: 'With Attachment',
      attachments: [attachmentInput],
    });

    expect(drafts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ filename: 'report.pdf' })],
      })
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe('report.pdf');
  });

  it('updates draft attachments', async () => {
    const existingDraft = { ...testDraft, id: 5, attachments: [] };
    const updatedDraft = {
      ...existingDraft,
      attachments: [{ ...attachmentInput, id: 1, draftId: 5 }],
    };
    const drafts = createMockDraftRepo({
      findById: vi.fn().mockResolvedValue(existingDraft),
      update: vi.fn().mockResolvedValue(updatedDraft),
    });

    const result = await saveDraft({ drafts })({
      id: 5,
      accountId: 1,
      attachments: [attachmentInput],
    });

    expect(drafts.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        attachments: [expect.objectContaining({ filename: 'report.pdf' })],
      })
    );
    expect(result.attachments).toHaveLength(1);
  });

  it('loads draft with attachments', async () => {
    const drafts = createMockDraftRepo({
      findById: vi.fn().mockResolvedValue(testDraftWithAttachment),
    });

    const result = await getDraft({ drafts })(3);

    expect(result?.attachments).toHaveLength(1);
    expect(result?.attachments[0].filename).toBe('document.pdf');
    expect(result?.attachments[0].content).toBe('base64encodedcontent');
  });

  it('lists drafts include attachments', async () => {
    const drafts = createMockDraftRepo({
      list: vi.fn().mockResolvedValue([testDraft, testDraftWithAttachment]),
    });

    const result = await listDrafts({ drafts })();

    expect(result[0].attachments).toEqual([]);
    expect(result[1].attachments).toHaveLength(1);
  });

  it('deleting draft removes attachments', async () => {
    const drafts = createMockDraftRepo();

    await deleteDraft({ drafts })(3);

    expect(drafts.delete).toHaveBeenCalledWith(3);
    // Attachments should be deleted via CASCADE in database
  });

  it('saves draft with multiple attachments', async () => {
    const attachments = [
      { filename: 'doc1.pdf', contentType: 'application/pdf', size: 1024, content: 'YWJj' },
      { filename: 'image.png', contentType: 'image/png', size: 2048, content: 'eHl6' },
    ];
    const savedDraft = {
      ...testDraft,
      attachments: attachments.map((a, i) => ({ ...a, id: i + 1, draftId: 1 })),
    };
    const drafts = createMockDraftRepo({
      save: vi.fn().mockResolvedValue(savedDraft),
    });

    const result = await saveDraft({ drafts })({
      accountId: 1,
      attachments,
    });

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0].filename).toBe('doc1.pdf');
    expect(result.attachments[1].filename).toBe('image.png');
  });

  it('clears attachments when saving with empty array', async () => {
    const existingDraft = { ...testDraftWithAttachment };
    const updatedDraft = { ...existingDraft, attachments: [] };
    const drafts = createMockDraftRepo({
      findById: vi.fn().mockResolvedValue(existingDraft),
      update: vi.fn().mockResolvedValue(updatedDraft),
    });

    const result = await saveDraft({ drafts })({
      id: 3,
      accountId: 1,
      attachments: [], // Explicitly clearing
    });

    expect(drafts.update).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ attachments: [] })
    );
    expect(result.attachments).toEqual([]);
  });
});

// ============================================
// AI Sort Use Case Tests
// ============================================

describe('getPendingReviewQueue', () => {
  it('returns pending review emails with their data', async () => {
    const pendingStates = [
      { emailId: 1, status: 'pending_review' as const, confidence: 0.72, priority: 'normal' as const, suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null },
    ];
    const classificationState = createMockClassificationStateRepo({
      listPendingReview: vi.fn().mockResolvedValue(pendingStates),
    });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
    });

    const result = await getPendingReviewQueue({ classificationState, emails })({ sortBy: 'confidence' });

    expect(classificationState.listPendingReview).toHaveBeenCalledWith({ sortBy: 'confidence' });
    expect(result).toHaveLength(1);
    expect(result[0].email).toEqual(testEmail);
  });
});

describe('getClassificationStats', () => {
  it('returns dashboard stats with budget from classifier', async () => {
    const classificationState = createMockClassificationStateRepo({
      getStats: vi.fn().mockResolvedValue({ classifiedToday: 50, pendingReview: 7, accuracy30Day: 0.89, budgetUsed: 100, budgetLimit: 200, priorityBreakdown: { high: 10, normal: 30, low: 10 } }),
    });
    const config = createMockConfig();
    const classifier = createMockClassifier({
      getEmailBudget: vi.fn().mockReturnValue({ used: 147, limit: 200, allowed: true }),
    });

    const result = await getClassificationStats({ classificationState, config, classifier })();

    expect(result.classifiedToday).toBe(50);
    expect(result.pendingReview).toBe(7);
    expect(result.accuracy30Day).toBe(0.89);
    expect(result.budgetUsed).toBe(147);
    expect(result.budgetLimit).toBe(200);
  });
});

describe('acceptClassification', () => {
  it('accepts with 100% accuracy when tags match exactly', async () => {
    const state = { emailId: 1, status: 'pending_review' as const, confidence: 0.72, priority: 'normal' as const, suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const tags = createMockTagRepo({
      findAll: vi.fn().mockResolvedValue(testTags),
    });

    await acceptClassification({ classificationState, tags })(1, ['work']);

    expect(classificationState.logFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: 'accept',
      accuracyScore: 1.0,
    }));
    expect(classificationState.setState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'accepted',
    }));
  });

  it('accepts with 98% accuracy when tags are edited', async () => {
    const state = { emailId: 1, status: 'pending_review' as const, confidence: 0.72, priority: 'normal' as const, suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const tags = createMockTagRepo({
      findAll: vi.fn().mockResolvedValue(testTags),
    });

    await acceptClassification({ classificationState, tags })(1, ['work', 'personal']);

    expect(classificationState.logFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: 'accept_edit',
      accuracyScore: 0.98,
    }));
  });

  it('applies tags to email after accepting', async () => {
    const state = { emailId: 1, status: 'pending_review' as const, confidence: 0.72, priority: 'normal' as const, suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const tags = createMockTagRepo({
      findAll: vi.fn().mockResolvedValue(testTags),
    });

    await acceptClassification({ classificationState, tags })(1, ['work']);

    expect(tags.apply).toHaveBeenCalledWith(1, 3, 'llm', 0.72); // testTags[2] is 'work' with id 3
  });

  it('throws when classification state not found', async () => {
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(null),
    });
    const tags = createMockTagRepo();

    await expect(acceptClassification({ classificationState, tags })(999, ['work']))
      .rejects.toThrow('Classification state not found');
  });
});

describe('dismissClassification', () => {
  it('dismisses with 0% accuracy', async () => {
    const state = { emailId: 1, status: 'pending_review' as const, confidence: 0.72, priority: 'normal' as const, suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
    });

    await dismissClassification({ classificationState, emails })(1);

    expect(classificationState.logFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dismiss',
      accuracyScore: 0.0,
      finalTags: null,
    }));
    expect(classificationState.setState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dismissed',
    }));
  });

  it('updates confused patterns on dismiss', async () => {
    const state = { emailId: 1, status: 'pending_review' as const, confidence: 0.72, priority: 'normal' as const, suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail), // has from.address = 'sender@example.com'
    });

    await dismissClassification({ classificationState, emails })(1);

    expect(classificationState.updateConfusedPattern).toHaveBeenCalledWith('sender_domain', 'example.com', 0.72);
  });
});

describe('getConfusedPatterns', () => {
  it('returns top confused patterns', async () => {
    const patterns = [
      { id: 1, patternType: 'sender_domain' as const, patternValue: 'newsletter.com', dismissalCount: 12, avgConfidence: 0.52, lastSeen: new Date() },
    ];
    const classificationState = createMockClassificationStateRepo({
      listConfusedPatterns: vi.fn().mockResolvedValue(patterns),
    });

    const result = await getConfusedPatterns({ classificationState })(5);

    expect(classificationState.listConfusedPatterns).toHaveBeenCalledWith(5, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].dismissalCount).toBe(12);
  });
});

describe('getPendingReviewCount', () => {
  it('returns count of pending review items', async () => {
    const classificationState = createMockClassificationStateRepo({
      countByStatus: vi.fn().mockResolvedValue({ unprocessed: 10, classified: 50, pending_review: 7, accepted: 100, dismissed: 5, error: 2 }),
    });

    const result = await getPendingReviewCount({ classificationState })();

    expect(result).toBe(7);
  });
});

// ============================================
// LLM Gate Use Case Tests
// ============================================

describe('isLLMConfigured', () => {
  describe('Anthropic provider', () => {
    it('returns configured when API key is valid', async () => {
      const llmProvider = createMockLLMProvider({
        type: 'anthropic',
        validateKey: vi.fn().mockResolvedValue({ valid: true }),
      });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'anthropic' }),
      });
      const secrets = createMockSecrets({
        getApiKey: vi.fn().mockResolvedValue('sk-valid-key'),
      });

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(secrets.getApiKey).toHaveBeenCalledWith('anthropic');
      expect(llmProvider.validateKey).toHaveBeenCalledWith('sk-valid-key');
    });

    it('returns not configured when no API key', async () => {
      const llmProvider = createMockLLMProvider({ type: 'anthropic' });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'anthropic' }),
      });
      const secrets = createMockSecrets({
        getApiKey: vi.fn().mockResolvedValue(null),
      });

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(false);
      expect(result.reason).toBe('No API key configured');
      expect(llmProvider.validateKey).not.toHaveBeenCalled();
    });

    it('returns not configured when API key is invalid', async () => {
      const llmProvider = createMockLLMProvider({
        type: 'anthropic',
        validateKey: vi.fn().mockResolvedValue({ valid: false, error: 'Invalid API key format' }),
      });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'anthropic' }),
      });
      const secrets = createMockSecrets({
        getApiKey: vi.fn().mockResolvedValue('invalid-key'),
      });

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(false);
      expect(result.reason).toBe('Invalid API key format');
    });
  });

  describe('Ollama provider', () => {
    it('returns configured when server reachable and has models', async () => {
      const llmProvider = createMockLLMProvider({
        type: 'ollama',
        testConnection: vi.fn().mockResolvedValue({ connected: true }),
        listModels: vi.fn().mockResolvedValue([{ id: 'llama2', displayName: 'Llama 2' }]),
      });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'ollama' }),
      });
      const secrets = createMockSecrets();

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns not configured when server not reachable', async () => {
      const llmProvider = createMockLLMProvider({
        type: 'ollama',
        testConnection: vi.fn().mockResolvedValue({ connected: false, error: 'Connection refused' }),
      });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'ollama' }),
      });
      const secrets = createMockSecrets();

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(false);
      expect(result.reason).toBe('Connection refused');
    });

    it('returns not configured when no models installed', async () => {
      const llmProvider = createMockLLMProvider({
        type: 'ollama',
        testConnection: vi.fn().mockResolvedValue({ connected: true }),
        listModels: vi.fn().mockResolvedValue([]),
      });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'ollama' }),
      });
      const secrets = createMockSecrets();

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(false);
      expect(result.reason).toBe('No models installed in Ollama');
    });

    it('returns not configured when testConnection not available', async () => {
      const llmProvider = createMockLLMProvider({
        type: 'ollama',
        testConnection: undefined,
      });
      const config = createMockConfig({
        getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'ollama' }),
      });
      const secrets = createMockSecrets();

      const result = await isLLMConfigured({ llmProvider, config, secrets })();

      expect(result.configured).toBe(false);
      expect(result.reason).toBe('Provider does not support connection test');
    });
  });
});

describe('startBackgroundClassification', () => {
  it('starts a background task and returns taskId', () => {
    const backgroundTasks = createMockBackgroundTaskManager();
    const classifier = createMockClassifier();
    const config = createMockConfig();
    const emails = createMockEmailRepo();
    const tags = createMockTagRepo();
    const classificationState = createMockClassificationStateRepo();

    const result = startBackgroundClassification({
      backgroundTasks,
      emails,
      tags,
      classifier,
      classificationState,
      config,
    })([1, 2, 3]);

    expect(result.taskId).toBeDefined();
    expect(result.count).toBe(3);
    expect(backgroundTasks.start).toHaveBeenCalledWith(
      result.taskId,
      3,
      expect.any(Function)
    );
  });

  it('respects daily budget and skips emails when exhausted', async () => {
    let budgetAllowed = true;
    let classifyCallCount = 0;
    const onProgressMock = vi.fn();

    const backgroundTasks = createMockBackgroundTaskManager({
      start: vi.fn().mockImplementation((_id, _total, fn) => {
        // Execute the function synchronously for testing
        fn(onProgressMock);
      }),
    });

    const classifier = createMockClassifier({
      classify: vi.fn().mockImplementation(async () => {
        classifyCallCount++;
        // After 2 classifications, budget is exhausted
        if (classifyCallCount >= 2) {
          budgetAllowed = false;
        }
        return {
          suggestedTags: ['work'],
          confidence: 0.9,
          reasoning: 'Test',
          priority: 'normal',
        };
      }),
      getEmailBudget: vi.fn().mockImplementation(() => ({
        used: classifyCallCount,
        limit: 2,
        allowed: budgetAllowed,
      })),
    });

    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig();

    startBackgroundClassification({
      backgroundTasks,
      emails,
      tags,
      classifier,
      classificationState,
      config,
    })([1, 2, 3, 4, 5]);

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have checked budget 5 times (once per email)
    // But only classified 2 emails before budget exhausted
    expect(classifier.getEmailBudget).toHaveBeenCalled();
    // Progress should be called for all emails (even skipped ones)
    expect(onProgressMock).toHaveBeenCalledTimes(5);
  });

  it('handles classification errors and continues', async () => {
    const onProgressMock = vi.fn();
    let callCount = 0;

    const backgroundTasks = createMockBackgroundTaskManager({
      start: vi.fn().mockImplementation((_id, _total, fn) => {
        fn(onProgressMock);
      }),
    });

    const classifier = createMockClassifier({
      classify: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('API error');
        }
        return {
          suggestedTags: ['work'],
          confidence: 0.9,
          reasoning: 'Test',
          priority: 'normal',
        };
      }),
      getEmailBudget: vi.fn().mockReturnValue({ used: 0, limit: 100, allowed: true }),
    });

    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig();

    startBackgroundClassification({
      backgroundTasks,
      emails,
      tags,
      classifier,
      classificationState,
      config,
    })([1, 2, 3]);

    await new Promise(resolve => setTimeout(resolve, 50));

    // All 3 emails should have been processed
    expect(onProgressMock).toHaveBeenCalledTimes(3);
    // Error state should be set for email 2
    expect(classificationState.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        emailId: expect.any(Number),
        status: 'error',
        errorMessage: 'API error',
      })
    );
  });
});

describe('getBackgroundTaskStatus', () => {
  it('returns task status when task exists', () => {
    const taskState: TaskState = {
      status: 'running',
      processed: 5,
      total: 10,
    };
    const backgroundTasks = createMockBackgroundTaskManager({
      getStatus: vi.fn().mockReturnValue(taskState),
    });

    const result = getBackgroundTaskStatus({ backgroundTasks })('task-123');

    expect(backgroundTasks.getStatus).toHaveBeenCalledWith('task-123');
    expect(result).toEqual(taskState);
  });

  it('returns null when task does not exist', () => {
    const backgroundTasks = createMockBackgroundTaskManager({
      getStatus: vi.fn().mockReturnValue(null),
    });

    const result = getBackgroundTaskStatus({ backgroundTasks })('nonexistent');

    expect(result).toBeNull();
  });
});

describe('clearBackgroundTask', () => {
  it('clears the task', () => {
    const backgroundTasks = createMockBackgroundTaskManager();

    clearBackgroundTask({ backgroundTasks })('task-123');

    expect(backgroundTasks.clear).toHaveBeenCalledWith('task-123');
  });
});

describe('startBackgroundClassification concurrency', () => {
  it('uses concurrency of 2 by default for Ollama provider', async () => {
    const processOrder: number[] = [];
    const onProgressMock = vi.fn();

    const backgroundTasks = createMockBackgroundTaskManager({
      start: vi.fn().mockImplementation((_id, _total, fn) => {
        fn(onProgressMock);
      }),
    });

    const classifier = createMockClassifier({
      classify: vi.fn().mockImplementation(async () => {
        // Simulate some async work
        await new Promise(resolve => setTimeout(resolve, 5));
        return {
          suggestedTags: ['work'],
          confidence: 0.9,
          reasoning: 'Test',
          priority: 'normal',
        };
      }),
      getEmailBudget: vi.fn().mockReturnValue({ used: 0, limit: 100, allowed: true }),
    });

    const emails = createMockEmailRepo({
      findById: vi.fn().mockImplementation((id) => {
        processOrder.push(id);
        return Promise.resolve({ ...testEmail, id });
      }),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig({
      getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'ollama' }),
    });

    startBackgroundClassification({
      backgroundTasks,
      emails,
      tags,
      classifier,
      classificationState,
      config,
    })([1, 2, 3, 4]);

    await new Promise(resolve => setTimeout(resolve, 100));

    // All 4 should be processed
    expect(onProgressMock).toHaveBeenCalledTimes(4);
  });

  it('uses concurrency of 1 for Anthropic provider', async () => {
    const onProgressMock = vi.fn();

    const backgroundTasks = createMockBackgroundTaskManager({
      start: vi.fn().mockImplementation((_id, _total, fn) => {
        fn(onProgressMock);
      }),
    });

    const classifier = createMockClassifier({
      classify: vi.fn().mockResolvedValue({
        suggestedTags: ['work'],
        confidence: 0.9,
        reasoning: 'Test',
        priority: 'normal',
      }),
      getEmailBudget: vi.fn().mockReturnValue({ used: 0, limit: 100, allowed: true }),
    });

    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig({
      getLLMConfig: vi.fn().mockReturnValue({ ...defaultLLMConfig, provider: 'anthropic' }),
    });

    startBackgroundClassification({
      backgroundTasks,
      emails,
      tags,
      classifier,
      classificationState,
      config,
    })([1, 2, 3]);

    await new Promise(resolve => setTimeout(resolve, 50));

    // All 3 should be processed sequentially
    expect(onProgressMock).toHaveBeenCalledTimes(3);
  });

  it('respects custom classificationConcurrency setting', async () => {
    const onProgressMock = vi.fn();

    const backgroundTasks = createMockBackgroundTaskManager({
      start: vi.fn().mockImplementation((_id, _total, fn) => {
        fn(onProgressMock);
      }),
    });

    const classifier = createMockClassifier({
      classify: vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return {
          suggestedTags: ['work'],
          confidence: 0.9,
          reasoning: 'Test',
          priority: 'normal',
        };
      }),
      getEmailBudget: vi.fn().mockReturnValue({ used: 0, limit: 100, allowed: true }),
    });

    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
      getBody: vi.fn().mockResolvedValue(testBody),
    });
    const tags = createMockTagRepo();
    const classificationState = createMockClassificationStateRepo();
    const config = createMockConfig({
      getLLMConfig: vi.fn().mockReturnValue({
        ...defaultLLMConfig,
        provider: 'ollama',
        classificationConcurrency: 3, // Custom concurrency
      }),
    });

    startBackgroundClassification({
      backgroundTasks,
      emails,
      tags,
      classifier,
      classificationState,
      config,
    })([1, 2, 3, 4, 5, 6]);

    await new Promise(resolve => setTimeout(resolve, 100));

    // All 6 should be processed
    expect(onProgressMock).toHaveBeenCalledTimes(6);
  });
});
