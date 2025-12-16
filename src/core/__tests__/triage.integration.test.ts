import { describe, it, expect, vi } from 'vitest';
import type { Email, TrainingExample, SenderRule, EmailSnooze, TriageLogEntry, TriageClassificationResult, Account, Folder } from '../domain';
import type { PatternMatcher, TriageClassifier, TrainingRepo, SenderRuleRepo, SnoozeRepo, TriageLogRepo, PatternMatchResult, EmailRepo, ImapFolderOps, AccountRepo, FolderRepo } from '../ports';
import {
  triageEmail,
  learnFromTriageCorrection,
  snoozeEmail,
  processSnoozedEmails,
  getTrainingExamples,
  ensureTriageFolders,
  getSenderRules,
  getTriageLog,
} from '../usecases';

// Test fixtures
const testEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  accountId: 1,
  folderId: 1,
  uid: 100,
  subject: '2FA Code: 123456',
  from: { address: 'noreply@github.com', name: 'GitHub' },
  to: ['user@example.com'],
  date: new Date('2024-01-15'),
  snippet: 'Your verification code is 123456',
  sizeBytes: 1024,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
};

const invoiceEmail: Email = {
  ...testEmail,
  id: 2,
  subject: 'Invoice #12345 - Payment Received',
  from: { address: 'billing@stripe.com', name: 'Stripe' },
  snippet: 'Thank you for your payment of $49.99',
};

const newsletterEmail: Email = {
  ...testEmail,
  id: 3,
  subject: 'Weekly Digest: Top Stories',
  from: { address: 'newsletter@medium.com', name: 'Medium Daily Digest' },
  snippet: 'Here are the top stories from this week...',
};

// Mock repositories
const createMockPatternMatcher = (result?: Partial<PatternMatchResult>): PatternMatcher => ({
  match: vi.fn().mockReturnValue({
    folder: result?.folder ?? 'INBOX',
    confidence: result?.confidence ?? 0.5,
    tags: result?.tags ?? [],
  }),
});

const createMockTriageClassifier = (result?: Partial<TriageClassificationResult>): TriageClassifier => ({
  classify: vi.fn().mockResolvedValue({
    folder: result?.folder ?? 'INBOX',
    tags: result?.tags ?? [],
    confidence: result?.confidence ?? 0.8,
    patternAgreed: result?.patternAgreed ?? true,
    reasoning: result?.reasoning ?? 'Test reasoning',
    snoozeUntil: result?.snoozeUntil,
    autoDeleteAfter: result?.autoDeleteAfter,
  }),
});

const createMockTrainingRepo = (): TrainingRepo => ({
  findByAccount: vi.fn().mockResolvedValue([]),
  findByDomain: vi.fn().mockResolvedValue([]),
  save: vi.fn().mockImplementation(async (ex) => ({ ...ex, id: 1, createdAt: new Date() })),
  getRelevantExamples: vi.fn().mockResolvedValue([]),
});

const createMockSenderRuleRepo = (): SenderRuleRepo => ({
  findByAccount: vi.fn().mockResolvedValue([]),
  findAutoApply: vi.fn().mockResolvedValue([]),
  findByPattern: vi.fn().mockResolvedValue(null),
  upsert: vi.fn().mockImplementation(async (rule) => ({
    ...rule,
    id: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  incrementCount: vi.fn().mockResolvedValue(undefined),
});

const createMockSnoozeRepo = (): SnoozeRepo => ({
  findByEmail: vi.fn().mockResolvedValue(null),
  findDue: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockImplementation(async (snooze) => ({ ...snooze, id: 1, createdAt: new Date() })),
  delete: vi.fn().mockResolvedValue(undefined),
});

const createMockTriageLogRepo = (): TriageLogRepo => ({
  log: vi.fn().mockResolvedValue(undefined),
  findByEmail: vi.fn().mockResolvedValue([]),
  findRecent: vi.fn().mockResolvedValue([]),
});

const createMockEmailRepo = (): EmailRepo => ({
  findById: vi.fn().mockImplementation(async (id) => {
    if (id === 1) return testEmail;
    if (id === 2) return invoiceEmail;
    if (id === 3) return newsletterEmail;
    return null;
  }),
  list: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockResolvedValue(testEmail),
  insertBatch: vi.fn().mockResolvedValue({ count: 0, ids: [] }),
  delete: vi.fn().mockResolvedValue(undefined),
  markRead: vi.fn().mockResolvedValue(undefined),
  setStar: vi.fn().mockResolvedValue(undefined),
  saveBody: vi.fn().mockResolvedValue(undefined),
  getBody: vi.fn().mockResolvedValue(null),
});

const createMockAccountRepo = (): AccountRepo => ({
  findById: vi.fn().mockResolvedValue({
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
  } as Account),
  findAll: vi.fn().mockResolvedValue([]),
  findByEmail: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({} as Account),
  update: vi.fn().mockResolvedValue({} as Account),
  delete: vi.fn().mockResolvedValue(undefined),
  updateLastSync: vi.fn().mockResolvedValue(undefined),
});

const createMockFolderRepo = (): FolderRepo => ({
  findById: vi.fn().mockResolvedValue({
    id: 1,
    accountId: 1,
    path: 'INBOX',
    name: 'INBOX',
    uidValidity: 12345,
    lastUid: 0,
  } as Folder),
  getOrCreate: vi.fn().mockResolvedValue({} as Folder),
  updateLastUid: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

const createMockImapFolderOps = (): ImapFolderOps => ({
  createFolder: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  listFolders: vi.fn().mockResolvedValue(['INBOX', 'Sent']),
  moveMessage: vi.fn().mockResolvedValue(undefined),
  ensureTriageFolders: vi.fn().mockResolvedValue([
    'INBOX', 'Planning', 'Review', 'Feed', 'Social', 'Promotions',
    'Paper-Trail/Invoices', 'Paper-Trail/Admin', 'Paper-Trail/Travel',
  ]),
});

describe('Triage Integration', () => {
  describe('triageEmail', () => {
    it('classifies 2FA email to INBOX with pattern hint', async () => {
      const patternMatcher = createMockPatternMatcher({ folder: 'INBOX', confidence: 0.95, tags: ['2fa'] });
      const triageClassifier = createMockTriageClassifier({ folder: 'INBOX', confidence: 0.95 });
      const trainingRepo = createMockTrainingRepo();
      const triageLog = createMockTriageLogRepo();
      const emails = createMockEmailRepo();

      const deps = { patternMatcher, triageClassifier, trainingRepo, triageLog, emails };
      const result = await triageEmail(deps)(1);

      expect(result.folder).toBe('INBOX');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(patternMatcher.match).toHaveBeenCalled();
      expect(triageClassifier.classify).toHaveBeenCalled();
    });

    it('classifies invoice email to Paper-Trail/Invoices', async () => {
      const patternMatcher = createMockPatternMatcher({
        folder: 'Paper-Trail/Invoices',
        confidence: 0.9,
        tags: ['invoice', 'payment'],
      });
      const triageClassifier = createMockTriageClassifier({
        folder: 'Paper-Trail/Invoices',
        confidence: 0.92,
        patternAgreed: true,
      });
      const trainingRepo = createMockTrainingRepo();
      const triageLog = createMockTriageLogRepo();
      const emails = createMockEmailRepo();

      const deps = { patternMatcher, triageClassifier, trainingRepo, triageLog, emails };
      const result = await triageEmail(deps)(2);

      expect(result.folder).toBe('Paper-Trail/Invoices');
      expect(result.patternAgreed).toBe(true);
    });

    it('classifier can override pattern suggestion', async () => {
      const patternMatcher = createMockPatternMatcher({
        folder: 'Promotions',
        confidence: 0.7,
      });
      const triageClassifier = createMockTriageClassifier({
        folder: 'Feed', // LLM overrides - actually a newsletter, not promo
        confidence: 0.85,
        patternAgreed: false,
        reasoning: 'This is a newsletter, not marketing promotion',
      });
      const trainingRepo = createMockTrainingRepo();
      const triageLog = createMockTriageLogRepo();
      const emails = createMockEmailRepo();

      const deps = { patternMatcher, triageClassifier, trainingRepo, triageLog, emails };
      const result = await triageEmail(deps)(3);

      expect(result.folder).toBe('Feed');
      expect(result.patternAgreed).toBe(false);
    });
  });

  describe('learnFromTriageCorrection', () => {
    it('saves training example when user corrects classification', async () => {
      const trainingRepo = createMockTrainingRepo();
      const senderRules = createMockSenderRuleRepo();
      const triageLog = createMockTriageLogRepo();
      const emails = createMockEmailRepo();

      const deps = { trainingRepo, senderRules, triageLog, emails };
      await learnFromTriageCorrection(deps)(2, 'INBOX', 'Paper-Trail/Invoices');

      expect(trainingRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 1,
          emailId: 2,
          fromDomain: 'stripe.com',
          aiSuggestion: 'INBOX',
          userChoice: 'Paper-Trail/Invoices',
          wasCorrection: true,
        })
      );
    });

    it('updates sender rule when pattern is learned', async () => {
      const trainingRepo = createMockTrainingRepo();
      const senderRules = createMockSenderRuleRepo();
      const triageLog = createMockTriageLogRepo();
      const emails = createMockEmailRepo();

      const deps = { trainingRepo, senderRules, triageLog, emails };
      await learnFromTriageCorrection(deps)(2, 'INBOX', 'Paper-Trail/Invoices');

      expect(senderRules.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'stripe.com',
          patternType: 'domain',
          targetFolder: 'Paper-Trail/Invoices',
        })
      );
    });
  });

  describe('snoozeEmail', () => {
    it('creates snooze record for email', async () => {
      const snoozes = createMockSnoozeRepo();
      const emails = createMockEmailRepo();
      const folders = createMockFolderRepo();

      const deps = { snoozes, emails, folders };
      const snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // +1 day
      await snoozeEmail(deps)(1, snoozeUntil, 'manual');

      expect(snoozes.create).toHaveBeenCalled();
    });
  });

  describe('processSnoozedEmails', () => {
    it('returns count of emails that are due to unsnooze', async () => {
      const dueSnooze: EmailSnooze = {
        id: 1,
        emailId: 1, // Use email ID 1 which exists in mock
        snoozeUntil: new Date(Date.now() - 1000), // Already due
        originalFolder: 'INBOX',
        reason: 'manual',
        createdAt: new Date(),
      };

      const snoozes = createMockSnoozeRepo();
      (snoozes.findDue as any).mockResolvedValue([dueSnooze]);

      const emails = createMockEmailRepo();
      const accounts = createMockAccountRepo();
      const folders = createMockFolderRepo();
      const imapFolderOps = createMockImapFolderOps();

      const deps = { snoozes, emails, accounts, folders, imapFolderOps };
      const result = await processSnoozedEmails(deps)();

      expect(result).toBe(1);
      expect(snoozes.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('ensureTriageFolders', () => {
    it('creates all required triage folders', async () => {
      const imapFolderOps = createMockImapFolderOps();
      const accounts = createMockAccountRepo();

      const deps = { imapFolderOps, accounts };
      const result = await ensureTriageFolders(deps)(1);

      expect(result).toContain('Planning');
      expect(result).toContain('Review');
      expect(result).toContain('Paper-Trail/Invoices');
      expect(imapFolderOps.ensureTriageFolders).toHaveBeenCalled();
    });
  });

  describe('getTrainingExamples', () => {
    it('returns training examples for account', async () => {
      const examples: TrainingExample[] = [
        {
          id: 1,
          accountId: 1,
          emailId: 1,
          fromAddress: 'test@example.com',
          fromDomain: 'example.com',
          subject: 'Test',
          aiSuggestion: 'INBOX',
          userChoice: 'Planning',
          wasCorrection: true,
          source: 'manual_move',
          createdAt: new Date(),
        },
      ];

      const trainingRepo = createMockTrainingRepo();
      (trainingRepo.findByAccount as any).mockResolvedValue(examples);

      const deps = { trainingRepo };
      const result = await getTrainingExamples(deps)(1);

      expect(result).toHaveLength(1);
      expect(result[0].wasCorrection).toBe(true);
    });
  });

  describe('getSenderRules', () => {
    it('returns sender rules for account', async () => {
      const rules: SenderRule[] = [
        {
          id: 1,
          accountId: 1,
          pattern: 'stripe.com',
          patternType: 'domain',
          targetFolder: 'Paper-Trail/Invoices',
          confidence: 0.95,
          correctionCount: 3,
          autoApply: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const senderRules = createMockSenderRuleRepo();
      (senderRules.findByAccount as any).mockResolvedValue(rules);

      const deps = { senderRules };
      const result = await getSenderRules(deps)(1);

      expect(result).toHaveLength(1);
      expect(result[0].autoApply).toBe(true);
    });
  });

  describe('getTriageLog', () => {
    it('returns recent log entries', async () => {
      const entries: TriageLogEntry[] = [
        {
          id: 1,
          emailId: 1,
          accountId: 1,
          patternHint: 'INBOX',
          llmFolder: 'INBOX',
          llmConfidence: 0.9,
          patternAgreed: true,
          finalFolder: 'INBOX',
          source: 'llm',
          reasoning: 'Test reasoning',
          createdAt: new Date(),
        },
        {
          id: 2,
          emailId: 2,
          accountId: 1,
          patternHint: 'Planning',
          llmFolder: 'Planning',
          llmConfidence: 0.85,
          patternAgreed: true,
          finalFolder: 'Planning',
          source: 'llm',
          reasoning: 'Test reasoning 2',
          createdAt: new Date(),
        },
      ];

      const triageLog = createMockTriageLogRepo();
      (triageLog.findRecent as any).mockResolvedValue(entries);

      const deps = { triageLog };
      const result = await getTriageLog(deps)(10, 1);

      expect(result).toHaveLength(2);
      expect(result[0].llmFolder).toBe('INBOX');
      expect(result[1].llmFolder).toBe('Planning');
    });
  });
});
