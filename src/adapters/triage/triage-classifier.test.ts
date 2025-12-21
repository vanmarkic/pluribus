import { describe, it, expect, vi } from 'vitest';
import { createTriageClassifier, buildTriagePrompt } from './triage-classifier';
import type { Email, TrainingExample } from '../../core/domain';
import type { PatternMatchResult } from '../../core/ports';

const baseEmail: Email = {
  id: 1,
  messageId: 'test@example.com',
  accountId: 1,
  folderId: 1,
  uid: 1,
  subject: 'Test Email',
  from: { address: 'test@amazon.com', name: 'Amazon' },
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

const basePatternHint: PatternMatchResult = {
  folder: 'INBOX',
  confidence: 0.85,
  tags: ['shipping'],
};

describe('TriageClassifier', () => {
  describe('buildTriagePrompt', () => {
    it('includes pattern hint in prompt', () => {
      const prompt = buildTriagePrompt(
        baseEmail,
        basePatternHint,
        []
      );

      expect(prompt).toContain('INBOX');
      expect(prompt).toContain('0.85');
      expect(prompt).toContain('shipping');
    });

    it('includes training examples', () => {
      const examples: Partial<TrainingExample>[] = [
        { fromDomain: 'amazon.com', userChoice: 'INBOX', wasCorrection: false, aiSuggestion: 'INBOX' },
      ];

      const prompt = buildTriagePrompt(
        baseEmail,
        basePatternHint,
        examples as TrainingExample[]
      );

      expect(prompt).toContain('amazon.com');
      expect(prompt).toContain('INBOX');
    });

    it('highlights corrections in training examples', () => {
      const examples: Partial<TrainingExample>[] = [
        { fromDomain: 'amazon.com', userChoice: 'Paper-Trail/Invoices', wasCorrection: true, aiSuggestion: 'INBOX' },
      ];

      const prompt = buildTriagePrompt(
        baseEmail,
        basePatternHint,
        examples as TrainingExample[]
      );

      expect(prompt).toContain('corrected to Paper-Trail/Invoices');
    });
  });

  describe('classify', () => {
    it('parses valid LLM response', async () => {
      const mockLLM = {
        complete: vi.fn().mockResolvedValue(JSON.stringify({
          folder: 'Paper-Trail/Invoices',
          tags: ['invoice', 'amazon'],
          confidence: 0.92,
          snoozeUntil: null,
          autoDeleteMinutes: null,
          patternAgreed: false,
          reasoning: 'This is an order receipt, not a shipping notification',
        })),
      };

      const classifier = createTriageClassifier(mockLLM);
      const result = await classifier.classify(baseEmail, basePatternHint, []);

      expect(result.folder).toBe('Paper-Trail/Invoices');
      expect(result.confidence).toBe(0.92);
      expect(result.patternAgreed).toBe(false);
      expect(result.tags).toContain('invoice');
    });

    it('falls back to Review on LLM error', async () => {
      const mockLLM = {
        complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      };

      const classifier = createTriageClassifier(mockLLM);
      const result = await classifier.classify(baseEmail, basePatternHint, []);

      expect(result.folder).toBe('Review');
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain('LLM error');
    });

    it('falls back to Review on invalid JSON', async () => {
      const mockLLM = {
        complete: vi.fn().mockResolvedValue('not valid json'),
      };

      const classifier = createTriageClassifier(mockLLM);
      const result = await classifier.classify(baseEmail, basePatternHint, []);

      expect(result.folder).toBe('Review');
      expect(result.confidence).toBe(0);
    });
  });
});
