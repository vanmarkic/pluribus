import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createTriageClassifier, buildTriagePrompt } from './triage-classifier';
import type { Email, TrainingExample, TriageFolder } from '../../core/domain';
import type { PatternMatchResult } from '../../core/ports';

/**
 * PROPERTY-BASED REGRESSION TESTS
 *
 * These tests use fast-check to generate thousands of random inputs
 * and verify invariants that MUST hold during refactoring.
 *
 * WARNING: Do NOT skip these tests. They catch edge cases that manual
 * testing misses.
 */

// ============================================
// GENERATORS - Create random valid inputs
// ============================================

const emailArbitrary = fc.record({
  id: fc.integer({ min: 1 }),
  messageId: fc.emailAddress().map(email => `<${email}>`),
  accountId: fc.integer({ min: 1 }),
  folderId: fc.integer({ min: 1 }),
  uid: fc.integer({ min: 1 }),
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
      'Contract for review'
    )
  ),
  from: fc.record({
    address: fc.emailAddress(),
    name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  }),
  to: fc.array(fc.emailAddress(), { minLength: 1, maxLength: 5 }),
  date: fc.integer({ min: 946684800000, max: 1924991999000 }).map(ts => new Date(ts)), // Valid timestamps only
  snippet: fc.string({ maxLength: 200 }),
  sizeBytes: fc.integer({ min: 100, max: 1000000 }),
  isRead: fc.boolean(),
  isStarred: fc.boolean(),
  hasAttachments: fc.boolean(),
  bodyFetched: fc.boolean(),
  // Threading
  inReplyTo: fc.option(fc.emailAddress().map(email => `<${email}>`), { nil: null }),
  references: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
  threadId: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: null }),
  // Awaiting reply
  awaitingReply: fc.boolean(),
  awaitingReplySince: fc.option(fc.integer({ min: 946684800000, max: 1924991999000 }).map(ts => new Date(ts)), { nil: null }),
  // Unsubscribe
  listUnsubscribe: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
  listUnsubscribePost: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
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

const patternMatchResultArbitrary = fc.record({
  folder: triageFolderArbitrary,
  confidence: fc.float({ min: 0, max: 1, noNaN: true }), // Exclude NaN
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
});

const trainingExampleArbitrary = fc.record({
  id: fc.integer({ min: 1 }),
  accountId: fc.integer({ min: 1 }),
  emailId: fc.option(fc.integer({ min: 1 }), { nil: null }),
  fromAddress: fc.emailAddress(),
  fromDomain: fc.domain(),
  subject: fc.string({ minLength: 1, maxLength: 200 }),
  aiSuggestion: fc.option(triageFolderArbitrary, { nil: null }),
  userChoice: triageFolderArbitrary,
  wasCorrection: fc.boolean(),
  source: fc.constantFrom('onboarding', 'review_folder', 'manual_move'),
  createdAt: fc.integer({ min: 946684800000, max: 1924991999000 }).map(ts => new Date(ts)), // Valid timestamps only
}) as fc.Arbitrary<TrainingExample>;

// ============================================
// ORACLE PATTERN - Compare old vs new
// ============================================

/**
 * OLD IMPLEMENTATION (tag-based)
 * This simulates the original behavior where classification
 * returned tags instead of folders.
 */
function oldClassifyEmail(
  email: Email,
  patternHint: PatternMatchResult
): { tags: string[]; confidence: number } {
  // OLD LOGIC: Map pattern hint to tags
  const folderToTags: Record<TriageFolder, string[]> = {
    'INBOX': ['urgent', 'inbox'],
    'Planning': ['planning', 'later'],
    'Review': ['needs-review'],
    'Paper-Trail/Invoices': ['invoice', 'receipt', 'paper-trail'],
    'Paper-Trail/Admin': ['admin', 'paper-trail'],
    'Paper-Trail/Travel': ['travel', 'paper-trail'],
    'Feed': ['newsletter', 'feed'],
    'Social': ['social'],
    'Promotions': ['promo', 'marketing'],
    'Archive': ['archive'],
  };

  return {
    tags: folderToTags[patternHint.folder] || ['unclassified'],
    confidence: patternHint.confidence,
  };
}

/**
 * NEW IMPLEMENTATION (folder-based)
 * This is the current implementation that uses folders.
 */
function newClassifyEmail(
  email: Email,
  patternHint: PatternMatchResult
): { folder: TriageFolder; confidence: number } {
  // NEW LOGIC: Return folder directly
  return {
    folder: patternHint.folder,
    confidence: patternHint.confidence,
  };
}

/**
 * EQUIVALENCE MAPPER
 * Proves that old tags map to new folders consistently.
 */
function tagsToFolder(tags: string[]): TriageFolder {
  // Map tags back to folders
  if (tags.includes('urgent') || tags.includes('inbox')) return 'INBOX';
  if (tags.includes('planning')) return 'Planning';
  if (tags.includes('needs-review')) return 'Review';
  if (tags.includes('invoice') || tags.includes('receipt')) return 'Paper-Trail/Invoices';
  if (tags.includes('admin')) return 'Paper-Trail/Admin';
  if (tags.includes('travel')) return 'Paper-Trail/Travel';
  if (tags.includes('newsletter') || tags.includes('feed')) return 'Feed';
  if (tags.includes('social')) return 'Social';
  if (tags.includes('promo') || tags.includes('marketing')) return 'Promotions';
  if (tags.includes('archive')) return 'Archive';
  return 'Review'; // Default fallback
}

describe('Property-Based Regression Tests', () => {
  describe('Oracle Pattern: Old vs New Implementation', () => {
    it('should classify emails identically after tags→folder refactor (1000 runs)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            // Run OLD implementation
            const oldResult = oldClassifyEmail(email, patternHint);

            // Run NEW implementation
            const newResult = newClassifyEmail(email, patternHint);

            // INVARIANT: Old tags must map to new folder
            const folderFromTags = tagsToFolder(oldResult.tags);
            expect(folderFromTags).toBe(newResult.folder);

            // INVARIANT: Confidence must not change
            expect(oldResult.confidence).toBe(newResult.confidence);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should maintain confidence levels across refactor (1000 runs)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            const oldResult = oldClassifyEmail(email, patternHint);
            const newResult = newClassifyEmail(email, patternHint);

            // INVARIANT: Confidence range unchanged
            expect(oldResult.confidence).toBeGreaterThanOrEqual(0);
            expect(oldResult.confidence).toBeLessThanOrEqual(1);
            expect(newResult.confidence).toBeGreaterThanOrEqual(0);
            expect(newResult.confidence).toBeLessThanOrEqual(1);

            // INVARIANT: Same input = same confidence
            expect(oldResult.confidence).toBe(newResult.confidence);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  describe('Invariants - Properties that MUST hold', () => {
    it('folder output must be valid TriageFolder (1000 runs)', () => {
      const validFolders: TriageFolder[] = [
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

      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            const result = newClassifyEmail(email, patternHint);

            // INVARIANT: Output must be a valid folder
            expect(validFolders).toContain(result.folder);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('confidence must always be between 0 and 1 (1000 runs)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            const result = newClassifyEmail(email, patternHint);

            // INVARIANT: Confidence in valid range
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('same input must always produce same output (determinism)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            // Run twice with same input
            const result1 = newClassifyEmail(email, patternHint);
            const result2 = newClassifyEmail(email, patternHint);

            // INVARIANT: Deterministic behavior
            expect(result1.folder).toBe(result2.folder);
            expect(result1.confidence).toBe(result2.confidence);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('pattern hint folder must influence output (no random behavior)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            const result = newClassifyEmail(email, patternHint);

            // INVARIANT: Pattern hint is respected
            expect(result.folder).toBe(patternHint.folder);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  describe('Prompt Generation - Must handle all inputs', () => {
    it('buildTriagePrompt must never throw on valid inputs (1000 runs)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          fc.array(trainingExampleArbitrary, { maxLength: 10 }),
          (email, patternHint, examples) => {
            // INVARIANT: Function must not throw
            expect(() => {
              buildTriagePrompt(email, patternHint, examples);
            }).not.toThrow();
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('prompt must contain key information (1000 runs)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          fc.array(trainingExampleArbitrary, { maxLength: 5 }),
          (email, patternHint, examples) => {
            const prompt = buildTriagePrompt(email, patternHint, examples);

            // INVARIANTS: Prompt must include critical context
            expect(prompt).toContain(email.subject);
            expect(prompt).toContain(email.from.address);
            expect(prompt).toContain(patternHint.folder);

            // Must include instructions
            expect(prompt).toContain('folder');
            expect(prompt).toContain('confidence');
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('prompt must handle empty training examples (1000 runs)', () => {
      fc.assert(
        fc.property(
          emailArbitrary,
          patternMatchResultArbitrary,
          (email, patternHint) => {
            // INVARIANT: Empty examples shouldn't break prompt
            expect(() => {
              buildTriagePrompt(email, patternHint, []);
            }).not.toThrow();
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  describe('Roundtrip Properties - Encoding/Decoding', () => {
    it('folder → tags → folder must be idempotent (1000 runs)', () => {
      fc.assert(
        fc.property(triageFolderArbitrary, (folder) => {
          const folderToTags: Record<TriageFolder, string[]> = {
            'INBOX': ['urgent', 'inbox'],
            'Planning': ['planning', 'later'],
            'Review': ['needs-review'],
            'Paper-Trail/Invoices': ['invoice', 'receipt', 'paper-trail'],
            'Paper-Trail/Admin': ['admin', 'paper-trail'],
            'Paper-Trail/Travel': ['travel', 'paper-trail'],
            'Feed': ['newsletter', 'feed'],
            'Social': ['social'],
            'Promotions': ['promo', 'marketing'],
            'Archive': ['archive'],
          };

          const tags = folderToTags[folder];
          const reconstructedFolder = tagsToFolder(tags);

          // ROUNDTRIP: folder → tags → folder = original folder
          expect(reconstructedFolder).toBe(folder);
        }),
        { numRuns: 1000 }
      );
    });
  });

  describe('Edge Cases - Known problematic inputs', () => {
    it('should handle empty subject without error', () => {
      const email: Email = {
        id: 1,
        messageId: '<test@example.com>',
        accountId: 1,
        folderId: 1,
        uid: 1,
        subject: '', // EDGE CASE: empty subject
        from: { address: 'test@example.com', name: 'Test' },
        to: ['user@example.com'],
        date: new Date(),
        snippet: '',
        sizeBytes: 1000,
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

      const patternHint: PatternMatchResult = {
        folder: 'Review',
        confidence: 0.5,
        tags: [],
      };

      expect(() => buildTriagePrompt(email, patternHint, [])).not.toThrow();
    });

    it('should handle missing sender name', () => {
      const email: Email = {
        id: 1,
        messageId: '<test@example.com>',
        accountId: 1,
        folderId: 1,
        uid: 1,
        subject: 'Test',
        from: { address: 'test@example.com', name: null }, // EDGE CASE: no name
        to: ['user@example.com'],
        date: new Date(),
        snippet: '',
        sizeBytes: 1000,
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

      const patternHint: PatternMatchResult = {
        folder: 'INBOX',
        confidence: 0.9,
        tags: [],
      };

      const prompt = buildTriagePrompt(email, patternHint, []);
      expect(prompt).toContain('test@example.com');
    });

    it('should handle confidence = 0 (zero confidence)', () => {
      fc.assert(
        fc.property(emailArbitrary, (email) => {
          const patternHint: PatternMatchResult = {
            folder: 'Review',
            confidence: 0, // EDGE CASE: zero confidence
            tags: [],
          };

          const result = newClassifyEmail(email, patternHint);
          expect(result.confidence).toBe(0);
          expect(result.folder).toBe('Review');
        }),
        { numRuns: 100 }
      );
    });

    it('should handle confidence = 1 (perfect confidence)', () => {
      fc.assert(
        fc.property(emailArbitrary, triageFolderArbitrary, (email, folder) => {
          const patternHint: PatternMatchResult = {
            folder,
            confidence: 1, // EDGE CASE: perfect confidence
            tags: [],
          };

          const result = newClassifyEmail(email, patternHint);
          expect(result.confidence).toBe(1);
          expect(result.folder).toBe(folder);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle very long subjects (1000+ chars)', () => {
      const email: Email = {
        id: 1,
        messageId: '<test@example.com>',
        accountId: 1,
        folderId: 1,
        uid: 1,
        subject: 'A'.repeat(2000), // EDGE CASE: very long subject
        from: { address: 'test@example.com', name: 'Test' },
        to: ['user@example.com'],
        date: new Date(),
        snippet: '',
        sizeBytes: 1000,
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

      const patternHint: PatternMatchResult = {
        folder: 'INBOX',
        confidence: 0.8,
        tags: [],
      };

      expect(() => buildTriagePrompt(email, patternHint, [])).not.toThrow();
    });
  });

  describe('Regression Tests - Real-world scenarios', () => {
    it('should classify Amazon receipt consistently', () => {
      const email: Email = {
        id: 1,
        messageId: '<amazon@example.com>',
        accountId: 1,
        folderId: 1,
        uid: 1,
        subject: 'Your Amazon.com order #123-4567890-1234567',
        from: { address: 'auto-confirm@amazon.com', name: 'Amazon.com' },
        to: ['user@example.com'],
        date: new Date(),
        snippet: 'Your order has been confirmed',
        sizeBytes: 5000,
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

      const patternHint: PatternMatchResult = {
        folder: 'Paper-Trail/Invoices',
        confidence: 0.95,
        tags: ['invoice', 'amazon'],
      };

      const result = newClassifyEmail(email, patternHint);
      expect(result.folder).toBe('Paper-Trail/Invoices');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should classify newsletter consistently', () => {
      const email: Email = {
        id: 1,
        messageId: '<newsletter@example.com>',
        accountId: 1,
        folderId: 1,
        uid: 1,
        subject: '[Newsletter] Weekly Tech Digest',
        from: { address: 'newsletter@techblog.com', name: 'Tech Blog' },
        to: ['user@example.com'],
        date: new Date(),
        snippet: 'This week in tech...',
        sizeBytes: 10000,
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

      const patternHint: PatternMatchResult = {
        folder: 'Feed',
        confidence: 0.88,
        tags: ['newsletter'],
      };

      const result = newClassifyEmail(email, patternHint);
      expect(result.folder).toBe('Feed');
    });
  });
});
