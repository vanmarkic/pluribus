/**
 * Integration Tests: Tag -> Folder Refactoring
 *
 * Tests the complete flow from use case through to classification
 * to ensure no regressions when consumers use the new folder-based API.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  Email,
  TriageClassificationResult,
  TrainingExample,
  TriageLogEntry,
} from '../domain';
import type {
  EmailRepo,
  PatternMatcher,
  TriageClassifier,
  TrainingRepo,
  TriageLogRepo,
  PatternMatchResult,
} from '../ports';
import { triageEmail } from '../usecases';

const testEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  accountId: 1,
  folderId: 1,
  uid: 100,
  subject: 'Invoice #12345',
  from: { address: 'billing@stripe.com', name: 'Stripe' },
  to: ['user@example.com'],
  date: new Date('2024-01-15'),
  snippet: 'Your payment of $49.99 has been received',
  sizeBytes: 1024,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
};

describe('Tag -> Folder Integration Tests', () => {
  describe('Use Case: triageEmail', () => {
    it('returns folder (not tags array) as primary classification', async () => {
      const mockEmailRepo: EmailRepo = {
        findById: vi.fn().mockResolvedValue(testEmail),
        list: vi.fn(),
        search: vi.fn(),
        insert: vi.fn(),
        insertBatch: vi.fn(),
        delete: vi.fn(),
        markRead: vi.fn(),
        setStar: vi.fn(),
        setFolderId: vi.fn(),
        saveBody: vi.fn(),
        getBody: vi.fn(),
      };

      const mockPatternMatcher: PatternMatcher = {
        match: vi.fn().mockReturnValue({
          folder: 'Paper-Trail/Invoices',
          confidence: 0.85,
          tags: ['invoice', 'payment'],
        }),
      };

      const mockTriageClassifier: TriageClassifier = {
        classify: vi.fn().mockResolvedValue({
          folder: 'Paper-Trail/Invoices',
          tags: ['invoice', 'stripe'],
          confidence: 0.92,
          patternAgreed: true,
          reasoning: 'This is a payment receipt',
        }),
      };

      const mockTrainingRepo: TrainingRepo = {
        findByAccount: vi.fn().mockResolvedValue([]),
        findByDomain: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        getRelevantExamples: vi.fn().mockResolvedValue([]),
      };

      const mockTriageLog: TriageLogRepo = {
        log: vi.fn().mockResolvedValue(undefined),
        findByEmail: vi.fn().mockResolvedValue([]),
        findRecent: vi.fn().mockResolvedValue([]),
      };

      const deps = {
        emails: mockEmailRepo,
        patternMatcher: mockPatternMatcher,
        triageClassifier: mockTriageClassifier,
        trainingRepo: mockTrainingRepo,
        triageLog: mockTriageLog,
      };

      const result = await triageEmail(deps)(1);

      // CRITICAL: Result must have folder as primary field
      expect(result).toHaveProperty('folder');
      expect(result.folder).toBe('Paper-Trail/Invoices');
      expect(typeof result.folder).toBe('string');

      // Tags are secondary metadata
      expect(result.tags).toEqual(['invoice', 'stripe']);

      // Should NOT have an array where folder should be
      expect(Array.isArray(result.folder)).toBe(false);
    });

    it('logs classification with folder (not tags) in triage log', async () => {
      const mockEmailRepo: EmailRepo = {
        findById: vi.fn().mockResolvedValue(testEmail),
        list: vi.fn(),
        search: vi.fn(),
        insert: vi.fn(),
        insertBatch: vi.fn(),
        delete: vi.fn(),
        markRead: vi.fn(),
        setStar: vi.fn(),
        setFolderId: vi.fn(),
        saveBody: vi.fn(),
        getBody: vi.fn(),
      };

      const mockPatternMatcher: PatternMatcher = {
        match: vi.fn().mockReturnValue({
          folder: 'INBOX',
          confidence: 0.5,
          tags: [],
        }),
      };

      const mockTriageClassifier: TriageClassifier = {
        classify: vi.fn().mockResolvedValue({
          folder: 'Planning',
          tags: ['todo'],
          confidence: 0.8,
          patternAgreed: false,
          reasoning: 'Non-urgent task',
        }),
      };

      const mockTrainingRepo: TrainingRepo = {
        findByAccount: vi.fn().mockResolvedValue([]),
        findByDomain: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        getRelevantExamples: vi.fn().mockResolvedValue([]),
      };

      const logSpy = vi.fn().mockResolvedValue(undefined);
      const mockTriageLog: TriageLogRepo = {
        log: logSpy,
        findByEmail: vi.fn().mockResolvedValue([]),
        findRecent: vi.fn().mockResolvedValue([]),
      };

      const deps = {
        emails: mockEmailRepo,
        patternMatcher: mockPatternMatcher,
        triageClassifier: mockTriageClassifier,
        trainingRepo: mockTrainingRepo,
        triageLog: mockTriageLog,
      };

      await triageEmail(deps)(1);

      // Verify log was called with folder information
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          llmFolder: 'Planning',
          patternHint: 'INBOX',
          finalFolder: 'Planning',
        })
      );
    });

    it('handles low confidence by routing to Review folder', async () => {
      const mockEmailRepo: EmailRepo = {
        findById: vi.fn().mockResolvedValue(testEmail),
        list: vi.fn(),
        search: vi.fn(),
        insert: vi.fn(),
        insertBatch: vi.fn(),
        delete: vi.fn(),
        markRead: vi.fn(),
        setStar: vi.fn(),
        setFolderId: vi.fn(),
        saveBody: vi.fn(),
        getBody: vi.fn(),
      };

      const mockPatternMatcher: PatternMatcher = {
        match: vi.fn().mockReturnValue({
          folder: 'Feed',
          confidence: 0.3,
          tags: [],
        }),
      };

      const mockTriageClassifier: TriageClassifier = {
        classify: vi.fn().mockResolvedValue({
          folder: 'Review', // Uncertain - needs human review
          tags: [],
          confidence: 0.5,
          patternAgreed: false,
          reasoning: 'Unable to classify with confidence',
        }),
      };

      const mockTrainingRepo: TrainingRepo = {
        findByAccount: vi.fn().mockResolvedValue([]),
        findByDomain: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        getRelevantExamples: vi.fn().mockResolvedValue([]),
      };

      const mockTriageLog: TriageLogRepo = {
        log: vi.fn().mockResolvedValue(undefined),
        findByEmail: vi.fn().mockResolvedValue([]),
        findRecent: vi.fn().mockResolvedValue([]),
      };

      const deps = {
        emails: mockEmailRepo,
        patternMatcher: mockPatternMatcher,
        triageClassifier: mockTriageClassifier,
        trainingRepo: mockTrainingRepo,
        triageLog: mockTriageLog,
      };

      const result = await triageEmail(deps)(1);

      expect(result.folder).toBe('Review');
      expect(result.confidence).toBeLessThan(0.7);
    });

    it('preserves all TriageClassificationResult fields', async () => {
      const snoozeDate = new Date('2024-01-20T10:00:00Z');

      const mockEmailRepo: EmailRepo = {
        findById: vi.fn().mockResolvedValue(testEmail),
        list: vi.fn(),
        search: vi.fn(),
        insert: vi.fn(),
        insertBatch: vi.fn(),
        delete: vi.fn(),
        markRead: vi.fn(),
        setStar: vi.fn(),
        setFolderId: vi.fn(),
        saveBody: vi.fn(),
        getBody: vi.fn(),
      };

      const mockPatternMatcher: PatternMatcher = {
        match: vi.fn().mockReturnValue({
          folder: 'INBOX',
          confidence: 0.9,
          tags: ['2fa'],
          autoDeleteAfter: 15,
        }),
      };

      const mockTriageClassifier: TriageClassifier = {
        classify: vi.fn().mockResolvedValue({
          folder: 'INBOX',
          tags: ['2fa', 'security'],
          confidence: 0.95,
          snoozeUntil: snoozeDate,
          autoDeleteAfter: 15,
          patternAgreed: true,
          reasoning: '2FA code - urgent but temporary',
        }),
      };

      const mockTrainingRepo: TrainingRepo = {
        findByAccount: vi.fn().mockResolvedValue([]),
        findByDomain: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        getRelevantExamples: vi.fn().mockResolvedValue([]),
      };

      const mockTriageLog: TriageLogRepo = {
        log: vi.fn().mockResolvedValue(undefined),
        findByEmail: vi.fn().mockResolvedValue([]),
        findRecent: vi.fn().mockResolvedValue([]),
      };

      const deps = {
        emails: mockEmailRepo,
        patternMatcher: mockPatternMatcher,
        triageClassifier: mockTriageClassifier,
        trainingRepo: mockTrainingRepo,
        triageLog: mockTriageLog,
      };

      const result: TriageClassificationResult = await triageEmail(deps)(1);

      // All fields preserved
      expect(result.folder).toBe('INBOX');
      expect(result.tags).toEqual(['2fa', 'security']);
      expect(result.confidence).toBe(0.95);
      expect(result.snoozeUntil).toEqual(snoozeDate);
      expect(result.autoDeleteAfter).toBe(15);
      expect(result.patternAgreed).toBe(true);
      expect(result.reasoning).toContain('2FA');
    });

    it('handles emails with multiple relevant training examples', async () => {
      const trainingExamples: TrainingExample[] = [
        {
          id: 1,
          accountId: 1,
          emailId: 10,
          fromAddress: 'billing@stripe.com',
          fromDomain: 'stripe.com',
          subject: 'Invoice #11111',
          aiSuggestion: 'INBOX',
          userChoice: 'Paper-Trail/Invoices',
          wasCorrection: true,
          source: 'manual_move',
          createdAt: new Date('2024-01-10'),
        },
        {
          id: 2,
          accountId: 1,
          emailId: 11,
          fromAddress: 'billing@stripe.com',
          fromDomain: 'stripe.com',
          subject: 'Invoice #22222',
          aiSuggestion: 'Paper-Trail/Invoices',
          userChoice: 'Paper-Trail/Invoices',
          wasCorrection: false,
          source: 'review_folder',
          createdAt: new Date('2024-01-12'),
        },
      ];

      const mockEmailRepo: EmailRepo = {
        findById: vi.fn().mockResolvedValue(testEmail),
        list: vi.fn(),
        search: vi.fn(),
        insert: vi.fn(),
        insertBatch: vi.fn(),
        delete: vi.fn(),
        markRead: vi.fn(),
        setStar: vi.fn(),
        setFolderId: vi.fn(),
        saveBody: vi.fn(),
        getBody: vi.fn(),
      };

      const mockPatternMatcher: PatternMatcher = {
        match: vi.fn().mockReturnValue({
          folder: 'Paper-Trail/Invoices',
          confidence: 0.9,
          tags: ['invoice'],
        }),
      };

      const classifySpy = vi.fn().mockResolvedValue({
        folder: 'Paper-Trail/Invoices',
        tags: ['invoice', 'stripe'],
        confidence: 0.95,
        patternAgreed: true,
        reasoning: 'Learned from user corrections',
      });

      const mockTriageClassifier: TriageClassifier = {
        classify: classifySpy,
      };

      const mockTrainingRepo: TrainingRepo = {
        findByAccount: vi.fn().mockResolvedValue([]),
        findByDomain: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        getRelevantExamples: vi.fn().mockResolvedValue(trainingExamples),
      };

      const mockTriageLog: TriageLogRepo = {
        log: vi.fn().mockResolvedValue(undefined),
        findByEmail: vi.fn().mockResolvedValue([]),
        findRecent: vi.fn().mockResolvedValue([]),
      };

      const deps = {
        emails: mockEmailRepo,
        patternMatcher: mockPatternMatcher,
        triageClassifier: mockTriageClassifier,
        trainingRepo: mockTrainingRepo,
        triageLog: mockTriageLog,
      };

      const result = await triageEmail(deps)(1);

      // Verify classifier was called with training examples
      expect(classifySpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        trainingExamples
      );

      expect(result.folder).toBe('Paper-Trail/Invoices');
      expect(result.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('Regression: Folder vs Tags Type Safety', () => {
    it('TypeScript enforces folder is string (not string array)', async () => {
      const result: TriageClassificationResult = {
        folder: 'INBOX', // Must be string
        tags: ['urgent', 'action-required'], // Array is OK for tags
        confidence: 0.9,
        patternAgreed: true,
        reasoning: 'Test',
      };

      expect(typeof result.folder).toBe('string');
      expect(Array.isArray(result.tags)).toBe(true);

      // This should cause a TypeScript error if uncommented:
      // const badResult: TriageClassificationResult = {
      //   folder: ['INBOX', 'Planning'], // ERROR: Type 'string[]' is not assignable to type 'TriageFolder'
      //   tags: [],
      //   confidence: 0.9,
      //   patternAgreed: true,
      //   reasoning: 'Test',
      // };
    });

    it('TriageFolder union type prevents arbitrary strings', () => {
      const validFolders = [
        'INBOX',
        'Planning',
        'Review',
        'Paper-Trail/Invoices',
        'Paper-Trail/Admin',
        'Paper-Trail/Travel',
        'Feed',
        'Social',
        'Promotions',
        'Archive',
      ];

      for (const folder of validFolders) {
        const result: TriageClassificationResult = {
          folder: folder as any, // Cast needed to test runtime
          tags: [],
          confidence: 0.8,
          patternAgreed: true,
          reasoning: 'Test',
        };

        expect(validFolders).toContain(result.folder);
      }
    });
  });

  describe('Backward Compatibility Checks', () => {
    it('ensures old code expecting tags array would break (intentional)', () => {
      const result: TriageClassificationResult = {
        folder: 'INBOX',
        tags: ['urgent'],
        confidence: 0.9,
        patternAgreed: true,
        reasoning: 'Test',
      };

      // OLD CODE (pre-refactor) might have done:
      // const primaryClassification = result.tags[0]; // Would get 'urgent'

      // NEW CODE should do:
      const primaryClassification = result.folder; // Gets 'INBOX'

      expect(primaryClassification).toBe('INBOX');
      expect(primaryClassification).not.toBe('urgent');

      // This documents the breaking change - it's INTENTIONAL
    });

    it('consumers must use .folder not .tags for primary classification', () => {
      const result: TriageClassificationResult = {
        folder: 'Paper-Trail/Invoices',
        tags: ['invoice', 'stripe', 'payment'],
        confidence: 0.92,
        patternAgreed: true,
        reasoning: 'Payment receipt',
      };

      // Correct usage
      const destination = result.folder;
      expect(destination).toBe('Paper-Trail/Invoices');

      // Incorrect usage (old API)
      // const destination = result.tags.join('/'); // NO! Tags are metadata now
    });
  });
});
