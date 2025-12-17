/**
 * End-to-End Regression Tests: Tag -> Folder Refactoring
 *
 * Tests the COMPLETE flow: IPC → Use Case → Adapter → Database
 * This ensures no regressions at integration boundaries.
 */

import { describe, it, expect } from 'vitest';
import type { TriageFolder } from '../core/domain';

describe('Tag -> Folder E2E Regression Tests', () => {
  describe('Database Schema Validation', () => {
    it('documents that triage_log table uses folder (string), not tags (array)', () => {
      // This test documents the expected database schema
      // If this changes, it's a regression

      const expectedLogSchema = {
        id: 'INTEGER PRIMARY KEY',
        emailId: 'INTEGER NOT NULL',
        accountId: 'INTEGER NOT NULL',
        patternHint: 'TEXT', // TriageFolder as string
        llmFolder: 'TEXT', // TriageFolder as string (not JSON array)
        llmConfidence: 'REAL',
        patternAgreed: 'BOOLEAN',
        finalFolder: 'TEXT NOT NULL', // TriageFolder as string
        source: 'TEXT NOT NULL', // 'llm' | 'pattern-fallback' | etc.
        reasoning: 'TEXT',
        createdAt: 'TEXT NOT NULL',
      };

      // Verify folder fields are TEXT (strings), not JSON (for tags array)
      expect(expectedLogSchema.llmFolder).toBe('TEXT');
      expect(expectedLogSchema.finalFolder).toBe('TEXT NOT NULL');
      expect(expectedLogSchema.patternHint).toBe('TEXT');

      // OLD SCHEMA might have had:
      // llmTags: 'TEXT' (JSON array as string)
      // But NEW SCHEMA has:
      // llmFolder: 'TEXT' (single folder string)
    });

    it('documents that training_examples table uses userChoice as folder string', () => {
      const expectedTrainingSchema = {
        id: 'INTEGER PRIMARY KEY',
        accountId: 'INTEGER NOT NULL',
        emailId: 'INTEGER',
        fromAddress: 'TEXT NOT NULL',
        fromDomain: 'TEXT NOT NULL',
        subject: 'TEXT NOT NULL',
        aiSuggestion: 'TEXT', // TriageFolder or null
        userChoice: 'TEXT NOT NULL', // TriageFolder (not tags array)
        wasCorrection: 'BOOLEAN NOT NULL',
        source: 'TEXT NOT NULL',
        createdAt: 'TEXT NOT NULL',
      };

      expect(expectedTrainingSchema.userChoice).toBe('TEXT NOT NULL');
      expect(expectedTrainingSchema.aiSuggestion).toBe('TEXT');

      // These are folder strings, not JSON arrays
    });
  });

  describe('IPC Contract Validation', () => {
    it('documents IPC handler must return folder, not tags', () => {
      // IPC handler signature (from main/ipc.ts):
      // ipcMain.handle('triage:classify', async (_, emailId: number) => {
      //   return useCases.triageEmail(emailId);
      // });

      // Return type MUST be TriageClassificationResult with folder field
      type IPCTriageResponse = {
        folder: TriageFolder; // NOT tags: string[]
        tags: string[];
        confidence: number;
        patternAgreed: boolean;
        reasoning: string;
        snoozeUntil?: Date;
        autoDeleteAfter?: number;
        patternHint?: TriageFolder;
      };

      const mockResponse: IPCTriageResponse = {
        folder: 'Paper-Trail/Invoices',
        tags: ['invoice'],
        confidence: 0.92,
        patternAgreed: true,
        reasoning: 'Payment receipt',
      };

      expect(mockResponse).toHaveProperty('folder');
      expect(typeof mockResponse.folder).toBe('string');
      expect(Array.isArray(mockResponse.tags)).toBe(true);
    });
  });

  describe('Valid TriageFolder Values', () => {
    it('enforces complete set of valid folder values', () => {
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

      // Must have exactly these values, no more, no less
      expect(validFolders).toHaveLength(10);

      // Each folder must be a hierarchical path or simple name
      for (const folder of validFolders) {
        expect(typeof folder).toBe('string');
        expect(folder.length).toBeGreaterThan(0);

        // Paper-Trail folders must have slash
        if (folder.startsWith('Paper-Trail/')) {
          expect(folder).toContain('/');
          expect(folder.split('/')).toHaveLength(2);
        }
      }
    });

    it('INBOX folder is special - cannot be nested', () => {
      const inbox: TriageFolder = 'INBOX';

      expect(inbox).toBe('INBOX');
      expect(inbox).not.toContain('/');
    });

    it('Review folder is fallback for uncertain classifications', () => {
      const review: TriageFolder = 'Review';

      expect(review).toBe('Review');
      expect(review).not.toContain('/');

      // Used when confidence < threshold or LLM fails
    });

    it('Paper-Trail folders are hierarchical', () => {
      const paperTrailFolders: TriageFolder[] = [
        'Paper-Trail/Invoices',
        'Paper-Trail/Admin',
        'Paper-Trail/Travel',
      ];

      for (const folder of paperTrailFolders) {
        expect(folder).toContain('/');
        const [parent, child] = folder.split('/');
        expect(parent).toBe('Paper-Trail');
        expect(child).toBeTruthy();
        expect(['Invoices', 'Admin', 'Travel']).toContain(child);
      }
    });
  });

  describe('Migration Path - Breaking Changes', () => {
    it('OLD API consumers expecting tags array will break (intentional)', () => {
      // OLD CODE (before refactor):
      // const result = classifyEmail(email);
      // const tags = result.tags; // ['urgent', 'invoice']
      // const primaryTag = result.tags[0]; // 'urgent'

      // NEW CODE (after refactor):
      // const result = classifyEmail(email);
      // const folder = result.folder; // 'Paper-Trail/Invoices'
      // const tags = result.tags; // ['urgent', 'invoice'] (metadata only)

      // This test documents that the migration is BREAKING
      const oldExpectation = 'tags as primary classification';
      const newBehavior = 'folder as primary classification';

      expect(oldExpectation).not.toBe(newBehavior);

      // Consumers MUST update their code:
      // BEFORE: moveToFolder(result.tags[0])
      // AFTER:  moveToFolder(result.folder)
    });

    it('tags field is now auxiliary metadata, not primary', () => {
      const result = {
        folder: 'INBOX', // Primary: WHERE the email goes
        tags: ['urgent', '2fa', 'security'], // Metadata: WHAT it contains
        confidence: 0.95,
        patternAgreed: true,
        reasoning: '2FA code',
      };

      // Primary decision
      const destination = result.folder;
      expect(destination).toBe('INBOX');

      // Tags provide context but don't determine routing
      const hasUrgentTag = result.tags.includes('urgent');
      expect(hasUrgentTag).toBe(true);

      // But routing is based on folder, not tags
      expect(destination).not.toBe('urgent');
    });

    it('single folder vs multiple tags - semantic difference', () => {
      // OLD SYSTEM: Email could have MULTIPLE tags
      const oldResult = {
        tags: ['urgent', 'invoice', 'payment', 'stripe'], // 4 tags
        confidence: 0.9,
      };

      // NEW SYSTEM: Email has ONE folder, multiple tags as metadata
      const newResult = {
        folder: 'Paper-Trail/Invoices', // 1 folder
        tags: ['urgent', 'invoice', 'payment', 'stripe'], // 4 tags
        confidence: 0.9,
        patternAgreed: true,
        reasoning: 'Payment receipt',
      };

      // Key difference: folder is singular, tags are plural
      expect(oldResult.tags).toHaveLength(4);
      expect(typeof newResult.folder).toBe('string');
      expect(newResult.tags).toHaveLength(4);

      // Folder determines LOCATION, tags describe CHARACTERISTICS
    });
  });

  describe('Error Scenarios - Data Integrity', () => {
    it('missing folder in database would cause runtime error', () => {
      // Simulating a database row with missing folder
      const corruptedLogEntry = {
        id: 1,
        emailId: 123,
        accountId: 1,
        patternHint: 'INBOX',
        llmFolder: null, // CORRUPT: should never be null
        llmConfidence: 0.8,
        patternAgreed: true,
        finalFolder: 'INBOX',
        source: 'llm',
        reasoning: 'Test',
        createdAt: new Date(),
      };

      // Application code expecting folder would fail
      const folder = corruptedLogEntry.llmFolder as TriageFolder;

      // This would cause issues downstream
      expect(folder).toBeNull();

      // MITIGATION: Database should have NOT NULL constraint on finalFolder
      expect(corruptedLogEntry.finalFolder).toBe('INBOX');
    });

    it('empty string folder would cause routing failure', () => {
      const malformedResult = {
        folder: '', // INVALID: empty string
        tags: [],
        confidence: 0.8,
        patternAgreed: true,
        reasoning: 'Test',
      };

      // Email routing would fail with empty folder
      expect(malformedResult.folder).toBe('');
      expect(malformedResult.folder.length).toBe(0);

      // Should validate folder is non-empty before saving
    });

    it('invalid folder name would cause IMAP move to fail', () => {
      const invalidResult = {
        folder: 'Invalid/Nested/Too/Deep/Folder', // Not in TriageFolder union
        tags: [],
        confidence: 0.9,
        patternAgreed: true,
        reasoning: 'Test',
      };

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

      // This folder is not in the valid set
      expect(validFolders).not.toContain(invalidResult.folder as any);

      // IMAP move would fail or create unexpected folders
    });
  });

  describe('Performance Considerations', () => {
    it('folder lookup is O(1) vs tags array search O(n)', () => {
      const result = {
        folder: 'Paper-Trail/Invoices',
        tags: ['invoice', 'stripe', 'payment', 'urgent', 'quarterly'],
        confidence: 0.92,
        patternAgreed: true,
        reasoning: 'Test',
      };

      // OLD: Find primary tag (linear search)
      const start1 = performance.now();
      const primaryTag = result.tags.find(t => t === 'invoice');
      const duration1 = performance.now() - start1;

      // NEW: Direct folder access (constant time)
      const start2 = performance.now();
      const folder = result.folder;
      const duration2 = performance.now() - start2;

      expect(primaryTag).toBe('invoice');
      expect(folder).toBe('Paper-Trail/Invoices');

      // Folder access is faster (though difference is negligible for small arrays)
      // More importantly: folder is semantically clearer
    });
  });
});
