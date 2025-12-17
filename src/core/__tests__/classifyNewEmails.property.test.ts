import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { classifyNewEmails } from '../usecases';
import type {
  Email,
  TriageFolder,
  TrainingExample,
  TriageClassificationResult,
  ClassificationState,
  Account,
  Folder,
} from '../domain';
import type {
  Deps,
  Classifier,
  ClassificationStateRepo,
  EmailRepo,
  AccountRepo,
  FolderRepo,
  PatternMatcher,
  TriageClassifier,
  TrainingRepo,
  TriageLogRepo,
  ImapFolderOps,
  ConfigStore,
  PatternMatchResult,
} from '../ports';

/**
 * PROPERTY-BASED REGRESSION TESTS FOR classifyNewEmails
 *
 * These tests verify that the refactored classifyNewEmails maintains the same
 * observable behavior as the original implementation.
 *
 * REFACTOR CONTEXT:
 * - BEFORE: Called both classifyAndApply() AND triageAndMoveEmail() (2 LLM calls per email)
 * - AFTER: Only calls triageAndMoveEmail() and syncs results to classificationState
 *
 * KEY PROPERTIES TO TEST:
 * 1. Same emails in = same emails classified (determinism aside from LLM)
 * 2. Budget limits are respected
 * 3. Emails sorted by date (most recent first) before classification
 * 4. Error handling continues on individual failures
 * 5. Classification state is properly synced after triage
 */

// ============================================
// GENERATORS - Create random valid inputs
// ============================================

const emailArbitrary = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  messageId: fc.emailAddress().map(email => `<${email}>`),
  accountId: fc.integer({ min: 1, max: 10 }),
  folderId: fc.integer({ min: 1, max: 100 }),
  uid: fc.integer({ min: 1, max: 100000 }),
  subject: fc.oneof(
    fc.string({ minLength: 1, maxLength: 200 }),
    fc.constantFrom(
      'Receipt from Amazon',
      'Your flight confirmation',
      'Security code: 123456',
      'Package shipped!',
      '[Newsletter] Weekly update',
      '50% OFF - Limited Time',
      'RE: Meeting tomorrow',
      'Contract for review',
      '',  // Edge case: empty subject
    )
  ),
  from: fc.record({
    address: fc.emailAddress(),
    name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  }),
  to: fc.array(fc.emailAddress(), { minLength: 1, maxLength: 5 }),
  date: fc.date({
    min: new Date('2020-01-01'),
    max: new Date('2025-12-31'),
  }),
  snippet: fc.string({ maxLength: 200 }),
  sizeBytes: fc.integer({ min: 100, max: 1000000 }),
  isRead: fc.boolean(),
  isStarred: fc.boolean(),
  hasAttachments: fc.boolean(),
  bodyFetched: fc.boolean(),
}) as fc.Arbitrary<Email>;

const triageFolderArbitrary = fc.constantFrom<TriageFolder>(
  'INBOX',
  'Planning',
  'Review',
  'Paper-Trail/Invoices',
  'Paper-Trail/Admin',
  'Paper-Trail/Travel',
  'Feed',
  'Social',
  'Promotions',
  'Archive'
);

const confidenceArbitrary = fc.float({
  min: 0,
  max: 1,
  noNaN: true,
});

const triageResultArbitrary = fc.record({
  folder: triageFolderArbitrary,
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
  confidence: confidenceArbitrary,
  patternAgreed: fc.boolean(),
  reasoning: fc.string({ minLength: 10, maxLength: 200 }),
  snoozeUntil: fc.option(fc.date(), { nil: undefined }),
  autoDeleteAfter: fc.option(fc.integer({ min: 5, max: 1440 }), { nil: undefined }),
}) as fc.Arbitrary<TriageClassificationResult>;

// ============================================
// MOCK FACTORIES
// ============================================

function createMockClassifier(budget: { used: number; limit: number }): Classifier {
  // limit=0 means unlimited (Ollama), always allowed
  const isUnlimited = budget.limit === 0;
  const allowed = isUnlimited || budget.used < budget.limit;
  return {
    classify: vi.fn().mockResolvedValue({
      suggestedFolder: 'Review' as TriageFolder,
      confidence: 0.85,
      reasoning: 'Mock classification',
      priority: 'normal',
    }),
    getBudget: vi.fn().mockReturnValue(budget),
    getEmailBudget: vi.fn().mockReturnValue({ ...budget, allowed }),
  };
}

function createMockEmailRepo(emails: Email[]): EmailRepo {
  return {
    findById: vi.fn().mockImplementation(async (id: number) => {
      return emails.find(e => e.id === id) || null;
    }),
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue({} as Email),
    insertBatch: vi.fn().mockResolvedValue({ count: 0, ids: [] }),
    delete: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
    setStar: vi.fn().mockResolvedValue(undefined),
    setFolderId: vi.fn().mockResolvedValue(undefined),
    saveBody: vi.fn().mockResolvedValue(undefined),
    getBody: vi.fn().mockResolvedValue(null),
  };
}

function createMockClassificationStateRepo(): ClassificationStateRepo {
  const states = new Map<number, ClassificationState>();

  return {
    getState: vi.fn().mockImplementation(async (emailId: number) => {
      return states.get(emailId) || null;
    }),
    setState: vi.fn().mockImplementation(async (state: Omit<ClassificationState, 'reviewedAt' | 'dismissedAt' | 'errorMessage'> & { reviewedAt?: Date | null; dismissedAt?: Date | null; errorMessage?: string | null }) => {
      states.set(state.emailId, state as ClassificationState);
    }),
    listPendingReview: vi.fn().mockResolvedValue([]),
    listByPriority: vi.fn().mockResolvedValue([]),
    listFailed: vi.fn().mockResolvedValue([]),
    countByStatus: vi.fn().mockResolvedValue({
      unprocessed: 0,
      classified: 0,
      pending_review: 0,
      accepted: 0,
      dismissed: 0,
      error: 0,
    }),
    listReclassifiable: vi.fn().mockResolvedValue([]),
    logFeedback: vi.fn().mockResolvedValue(undefined),
    listRecentFeedback: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({
      classifiedToday: 0,
      pendingReview: 0,
      accuracy30Day: 0,
      budgetUsed: 0,
      budgetLimit: 0,
      priorityBreakdown: { high: 0, normal: 0, low: 0 },
    }),
    getAccuracy30Day: vi.fn().mockResolvedValue(0),
    listConfusedPatterns: vi.fn().mockResolvedValue([]),
    updateConfusedPattern: vi.fn().mockResolvedValue(undefined),
    clearConfusedPatterns: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPatternMatcher(defaultFolder: TriageFolder = 'Review'): PatternMatcher {
  return {
    match: vi.fn().mockReturnValue({
      folder: defaultFolder,
      confidence: 0.5,
      tags: [],
    } as PatternMatchResult),
  };
}

function createMockTriageClassifier(results: Map<number, TriageClassificationResult>): TriageClassifier {
  return {
    classify: vi.fn().mockImplementation(async (email: Email) => {
      return results.get(email.id) || {
        folder: 'Review' as TriageFolder,
        tags: [],
        confidence: 0.7,
        patternAgreed: true,
        reasoning: 'Default classification',
      };
    }),
  };
}

function createMockTrainingRepo(): TrainingRepo {
  return {
    findByAccount: vi.fn().mockResolvedValue([]),
    findByDomain: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue({} as TrainingExample),
    getRelevantExamples: vi.fn().mockResolvedValue([]),
  };
}

function createMockTriageLogRepo(): TriageLogRepo {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    findByEmail: vi.fn().mockResolvedValue([]),
    findRecent: vi.fn().mockResolvedValue([]),
  };
}

function createMockAccountRepo(): AccountRepo {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 1,
      email: 'test@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
    } as Account),
    findAll: vi.fn().mockResolvedValue([]),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({} as Account),
    update: vi.fn().mockResolvedValue({} as Account),
    delete: vi.fn().mockResolvedValue(undefined),
    updateLastSync: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFolderRepo(): FolderRepo {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 1,
      accountId: 1,
      path: 'INBOX',
      name: 'INBOX',
    } as Folder),
    getOrCreate: vi.fn().mockResolvedValue({} as Folder),
    updateLastUid: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockImapFolderOps(): ImapFolderOps {
  return {
    createFolder: vi.fn().mockResolvedValue(undefined),
    deleteFolder: vi.fn().mockResolvedValue(undefined),
    listFolders: vi.fn().mockResolvedValue([]),
    moveMessage: vi.fn().mockResolvedValue(undefined),
    moveToTrash: vi.fn().mockResolvedValue('Trash'),
    ensureTriageFolders: vi.fn().mockResolvedValue([]),
  };
}

function createMockConfigStore(): ConfigStore {
  return {
    getLLMConfig: vi.fn().mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      dailyBudget: 100,
      dailyEmailLimit: 1000,
      autoClassify: true,
      confidenceThreshold: 0.85,
      reclassifyCooldownDays: 7,
    }),
    getRemoteImagesSetting: vi.fn().mockReturnValue('block'),
    setRemoteImagesSetting: vi.fn(),
  };
}

// ============================================
// PROPERTY TESTS
// ============================================

describe('classifyNewEmails - Property-Based Regression Tests', () => {
  describe('Property: Budget Limits are Respected', () => {
    it('should never classify more emails than budget allows (1000 runs)', async () => {
      await await fc.assert(
        fc.asyncProperty(
          fc.array(emailArbitrary, { minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 50 }),
          async (emails, budgetLimit, budgetUsed) => {
            // limit=0 means unlimited (Ollama), otherwise calculate remaining
            const isUnlimited = budgetLimit === 0;
            const remainingBudget = isUnlimited ? emails.length : Math.max(0, budgetLimit - budgetUsed);

            const classifier = createMockClassifier({ used: budgetUsed, limit: budgetLimit });
            const emailRepo = createMockEmailRepo(emails);
            const classificationState = createMockClassificationStateRepo();
            const patternMatcher = createMockPatternMatcher();
            const triageResults = new Map(
              emails.map(e => [e.id, {
                folder: 'Review' as TriageFolder,
                tags: [],
                confidence: 0.8,
                patternAgreed: true,
                reasoning: 'Test',
              }])
            );
            const triageClassifier = createMockTriageClassifier(triageResults);

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher,
              triageClassifier,
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const result = await classifyNewEmails(deps)(
              emails.map(e => e.id),
              0.85
            );

            // INVARIANT: classified + skipped must equal total input
            expect(result.classified + result.skipped).toBe(emails.length);

            // INVARIANT: classified count must not exceed remaining budget
            expect(result.classified).toBeLessThanOrEqual(remainingBudget);

            // INVARIANT: if budget exhausted (but not unlimited), all should be skipped
            if (!isUnlimited && remainingBudget === 0) {
              expect(result.classified).toBe(0);
              expect(result.skipped).toBe(emails.length);
            }

            // INVARIANT: triaged count should match classified count (after refactor)
            expect(result.triaged).toBe(result.classified);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should skip all emails when budget is exhausted at start (100 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(emailArbitrary, { minLength: 1, maxLength: 20 }),
          async (emails) => {
            const classifier = createMockClassifier({ used: 100, limit: 100 }); // Budget exhausted
            const emailRepo = createMockEmailRepo(emails);
            const classificationState = createMockClassificationStateRepo();

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier: createMockTriageClassifier(new Map()),
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const result = await classifyNewEmails(deps)(
              emails.map(e => e.id),
              0.85
            );

            // INVARIANT: No classifications when budget exhausted
            expect(result.classified).toBe(0);
            expect(result.triaged).toBe(0);
            expect(result.skipped).toBe(emails.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Emails Sorted by Date (Most Recent First)', () => {
    it('should prioritize most recent emails when budget is limited (500 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(emailArbitrary, { minLength: 5, maxLength: 20 }),
          fc.integer({ min: 1, max: 10 }),
          async (emails, budgetLimit) => {
            // Ensure emails have different dates
            const emailsWithDates = emails.map((e, i) => ({
              ...e,
              date: new Date(Date.now() - i * 86400000), // Each email 1 day apart
            }));

            const classifier = createMockClassifier({ used: 0, limit: budgetLimit });
            const emailRepo = createMockEmailRepo(emailsWithDates);
            const classificationState = createMockClassificationStateRepo();
            const triageClassifier = createMockTriageClassifier(new Map(
              emailsWithDates.map(e => [e.id, {
                folder: 'Review' as TriageFolder,
                tags: [],
                confidence: 0.8,
                patternAgreed: true,
                reasoning: 'Test',
              }])
            ));

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier,
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            await classifyNewEmails(deps)(
              emailsWithDates.map(e => e.id),
              0.85
            );

            // Get the order in which triageClassifier was called
            const classifyCalls = (triageClassifier.classify as any).mock.calls;

            if (classifyCalls.length > 1) {
              // INVARIANT: Emails should be classified in date descending order
              for (let i = 1; i < classifyCalls.length; i++) {
                const prevEmail = classifyCalls[i - 1][0] as Email;
                const currEmail = classifyCalls[i][0] as Email;

                // Previous email should be more recent (or equal) to current
                expect(prevEmail.date.getTime()).toBeGreaterThanOrEqual(currEmail.date.getTime());
              }
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Property: Error Handling Continues on Individual Failures', () => {
    it('should continue processing remaining emails after individual errors (200 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(emailArbitrary, { minLength: 3, maxLength: 10 }),
          fc.integer({ min: 0, max: 5 }), // Number of emails to fail
          async (emails, numFailures) => {
            // Ensure unique IDs to avoid test flakiness
            const uniqueEmails = emails.map((e, i) => ({ ...e, id: i + 1 }));
            const failCount = Math.min(numFailures, uniqueEmails.length);
            const failIds = new Set(
              uniqueEmails.slice(0, failCount).map(e => e.id)
            );

            const classifier = createMockClassifier({ used: 0, limit: 100 });
            const emailRepo = createMockEmailRepo(uniqueEmails);
            const classificationState = createMockClassificationStateRepo();

            // Mock triageClassifier to fail for specific emails
            const triageClassifier: TriageClassifier = {
              classify: vi.fn().mockImplementation(async (email: Email) => {
                if (failIds.has(email.id)) {
                  throw new Error(`Failed to classify email ${email.id}`);
                }
                return {
                  folder: 'Review' as TriageFolder,
                  tags: [],
                  confidence: 0.8,
                  patternAgreed: true,
                  reasoning: 'Success',
                };
              }),
            };

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier,
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const result = await classifyNewEmails(deps)(
              uniqueEmails.map(e => e.id),
              0.85
            );

            // INVARIANT: Should continue processing despite errors
            // Only successful emails are counted as classified
            expect(result.classified).toBe(uniqueEmails.length - failCount);
            expect(result.triaged).toBe(uniqueEmails.length - failCount);

            // INVARIANT: Skipped is pre-calculated based on budget, not errors
            expect(result.skipped).toBe(0); // Budget is 100, all emails fit

            // INVARIANT: Error states should be recorded for failed emails
            for (const failedId of failIds) {
              const state = await classificationState.getState(failedId);
              expect(state).not.toBeNull();
              expect(state?.status).toBe('error');
              expect(state?.errorMessage).toBeTruthy();
            }

            // INVARIANT: Successful emails should have proper state
            const successIds = uniqueEmails.filter(e => !failIds.has(e.id)).map(e => e.id);
            for (const successId of successIds) {
              const state = await classificationState.getState(successId);
              expect(state).not.toBeNull();
              expect(state?.status).not.toBe('error');
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property: Classification State is Properly Synced', () => {
    it('should sync triage results to classificationState for all processed emails (500 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(emailArbitrary, { minLength: 1, maxLength: 15 }),
          fc.array(triageResultArbitrary, { minLength: 1, maxLength: 15 }),
          async (emails, triageResults) => {
            // Pair emails with triage results
            const resultMap = new Map(
              emails.map((e, i) => [
                e.id,
                triageResults[i % triageResults.length],
              ])
            );

            const classifier = createMockClassifier({ used: 0, limit: 100 });
            const emailRepo = createMockEmailRepo(emails);
            const classificationState = createMockClassificationStateRepo();
            const triageClassifier = createMockTriageClassifier(resultMap);

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier,
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const confidenceThreshold = 0.85;
            await classifyNewEmails(deps)(
              emails.map(e => e.id),
              confidenceThreshold
            );

            // INVARIANT: Every processed email should have state synced
            for (const email of emails) {
              const state = await classificationState.getState(email.id);
              const expectedResult = resultMap.get(email.id)!;

              expect(state).not.toBeNull();

              // INVARIANT: Folder matches triage result
              expect(state?.suggestedFolder).toBe(expectedResult.folder);

              // INVARIANT: Confidence matches triage result
              expect(state?.confidence).toBe(expectedResult.confidence);

              // INVARIANT: Status based on confidence threshold
              if (expectedResult.confidence >= confidenceThreshold) {
                expect(state?.status).toBe('classified');
              } else {
                expect(state?.status).toBe('pending_review');
              }

              // INVARIANT: Reasoning is preserved
              expect(state?.reasoning).toBe(expectedResult.reasoning);

              // INVARIANT: Priority is set based on confidence
              expect(state?.priority).toBeTruthy();

              // INVARIANT: classifiedAt timestamp is set
              expect(state?.classifiedAt).toBeInstanceOf(Date);

              // INVARIANT: No error message for successful classification
              expect(state?.errorMessage).toBeNull();
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should set correct status based on confidence threshold (500 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          emailArbitrary,
          confidenceArbitrary,
          confidenceArbitrary,
          async (email, triageConfidence, threshold) => {
            const validThreshold = Math.max(0, Math.min(1, threshold)); // Clamp to [0, 1]

            const triageResult: TriageClassificationResult = {
              folder: 'Review',
              tags: [],
              confidence: triageConfidence,
              patternAgreed: true,
              reasoning: 'Test',
            };

            const classifier = createMockClassifier({ used: 0, limit: 100 });
            const emailRepo = createMockEmailRepo([email]);
            const classificationState = createMockClassificationStateRepo();
            const triageClassifier = createMockTriageClassifier(
              new Map([[email.id, triageResult]])
            );

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier,
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            await classifyNewEmails(deps)([email.id], validThreshold);

            const state = await classificationState.getState(email.id);

            // INVARIANT: Status matches confidence threshold logic
            if (triageConfidence >= validThreshold) {
              expect(state?.status).toBe('classified');
            } else {
              expect(state?.status).toBe('pending_review');
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Property: Same Input Produces Consistent Output Structure', () => {
    it('should always return { classified, skipped, triaged } with valid counts (1000 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(emailArbitrary, { maxLength: 30 }),
          async (emails) => {
            const classifier = createMockClassifier({ used: 0, limit: 100 });
            const emailRepo = createMockEmailRepo(emails);
            const classificationState = createMockClassificationStateRepo();
            const triageClassifier = createMockTriageClassifier(
              new Map(
                emails.map(e => [e.id, {
                  folder: 'Review' as TriageFolder,
                  tags: [],
                  confidence: 0.8,
                  patternAgreed: true,
                  reasoning: 'Test',
                }])
              )
            );

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier,
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const result = await classifyNewEmails(deps)(
              emails.map(e => e.id),
              0.85
            );

            // INVARIANT: Result has correct structure
            expect(result).toHaveProperty('classified');
            expect(result).toHaveProperty('skipped');
            expect(result).toHaveProperty('triaged');

            // INVARIANT: All counts are non-negative integers
            expect(result.classified).toBeGreaterThanOrEqual(0);
            expect(result.skipped).toBeGreaterThanOrEqual(0);
            expect(result.triaged).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.classified)).toBe(true);
            expect(Number.isInteger(result.skipped)).toBe(true);
            expect(Number.isInteger(result.triaged)).toBe(true);

            // INVARIANT: classified + skipped = total input
            expect(result.classified + result.skipped).toBe(emails.length);

            // INVARIANT: triaged <= classified (after refactor, should be equal)
            expect(result.triaged).toBeLessThanOrEqual(result.classified);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  describe('Property: Empty Input Handling', () => {
    it('should handle empty email list gracefully (100 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant([]),
          async (emails: Email[]) => {
            const classifier = createMockClassifier({ used: 0, limit: 100 });
            const emailRepo = createMockEmailRepo(emails);
            const classificationState = createMockClassificationStateRepo();

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier: createMockTriageClassifier(new Map()),
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const result = await classifyNewEmails(deps)([], 0.85);

            // INVARIANT: Empty input returns zero counts
            expect(result.classified).toBe(0);
            expect(result.skipped).toBe(0);
            expect(result.triaged).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle emails that do not exist in database (100 runs)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 1000, max: 9999 }), { minLength: 1, maxLength: 10 }),
          async (nonExistentIds) => {
            const classifier = createMockClassifier({ used: 0, limit: 100 });
            const emailRepo = createMockEmailRepo([]); // No emails in repo
            const classificationState = createMockClassificationStateRepo();

            const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
              emails: emailRepo,
              classifier,
              classificationState,
              accounts: createMockAccountRepo(),
              folders: createMockFolderRepo(),
              patternMatcher: createMockPatternMatcher(),
              triageClassifier: createMockTriageClassifier(new Map()),
              trainingRepo: createMockTrainingRepo(),
              triageLog: createMockTriageLogRepo(),
              imapFolderOps: createMockImapFolderOps(),
              config: createMockConfigStore(),
            };

            const result = await classifyNewEmails(deps)(nonExistentIds, 0.85);

            // INVARIANT: Non-existent emails are filtered out before classification
            expect(result.classified).toBe(0);
            expect(result.triaged).toBe(0);
            // When emails don't exist, they're filtered out (not in emailsToClassify)
            // so skipped = inputLength - emailsToClassify.length = inputLength - 0
            expect(result.skipped).toBe(nonExistentIds.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge Cases - Real-world Scenarios', () => {
    it('should handle partial budget exhaustion mid-batch', async () => {
      const emails = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        messageId: `<test-${i}@example.com>`,
        accountId: 1,
        folderId: 1,
        uid: i + 1,
        subject: `Email ${i}`,
        from: { address: 'test@example.com', name: 'Test' },
        to: ['user@example.com'],
        date: new Date(Date.now() - i * 1000),
        snippet: 'test',
        sizeBytes: 1000,
        isRead: false,
        isStarred: false,
        hasAttachments: false,
        bodyFetched: false,
      }));

      const classifier = createMockClassifier({ used: 95, limit: 100 }); // Only 5 remaining
      const emailRepo = createMockEmailRepo(emails);
      const classificationState = createMockClassificationStateRepo();
      const triageClassifier = createMockTriageClassifier(
        new Map(
          emails.map(e => [e.id, {
            folder: 'Review' as TriageFolder,
            tags: [],
            confidence: 0.8,
            patternAgreed: true,
            reasoning: 'Test',
          }])
        )
      );

      const deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'> = {
        emails: emailRepo,
        classifier,
        classificationState,
        accounts: createMockAccountRepo(),
        folders: createMockFolderRepo(),
        patternMatcher: createMockPatternMatcher(),
        triageClassifier,
        trainingRepo: createMockTrainingRepo(),
        triageLog: createMockTriageLogRepo(),
        imapFolderOps: createMockImapFolderOps(),
        config: createMockConfigStore(),
      };

      const result = await classifyNewEmails(deps)(
        emails.map(e => e.id),
        0.85
      );

      expect(result.classified).toBe(5); // Only 5 can be classified
      expect(result.skipped).toBe(5);    // Rest are skipped
      expect(result.triaged).toBe(5);
    });
  });
});
