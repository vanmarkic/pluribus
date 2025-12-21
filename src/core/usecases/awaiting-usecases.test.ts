/**
 * Awaiting Reply Use Cases - Tests
 *
 * Task 9: Awaiting Detection Use Case
 */

import { describe, it, expect, vi } from 'vitest';
import { shouldTrackAwaiting, markAwaiting, clearAwaitingByReply } from './awaiting-usecases';

describe('awaiting usecases', () => {
  describe('shouldTrackAwaiting', () => {
    it('returns true if body contains question mark', async () => {
      const deps = { llm: { generate: vi.fn() } };

      const result = await shouldTrackAwaiting(deps)('Can you send me the report?');

      expect(result).toBe(true);
      expect(deps.llm.generate).not.toHaveBeenCalled();
    });

    it('calls LLM if no question mark', async () => {
      const deps = {
        llm: {
          generate: vi.fn().mockResolvedValue('yes'),
        },
      };

      const result = await shouldTrackAwaiting(deps)('Please send me the report.');

      expect(deps.llm.generate).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false if LLM says no', async () => {
      const deps = {
        llm: {
          generate: vi.fn().mockResolvedValue('no'),
        },
      };

      const result = await shouldTrackAwaiting(deps)('Thanks for your help.');

      expect(result).toBe(false);
    });
  });

  describe('markAwaiting', () => {
    it('calls awaiting repo', async () => {
      const deps = {
        awaiting: {
          markAwaiting: vi.fn().mockResolvedValue(undefined),
          clearAwaiting: vi.fn(),
          clearByReply: vi.fn(),
          getAwaitingList: vi.fn(),
        },
      };

      await markAwaiting(deps)(42);

      expect(deps.awaiting.markAwaiting).toHaveBeenCalledWith(42);
    });
  });

  describe('clearAwaitingByReply', () => {
    it('clears awaiting when reply detected', async () => {
      const deps = {
        awaiting: {
          markAwaiting: vi.fn(),
          clearAwaiting: vi.fn(),
          clearByReply: vi.fn().mockResolvedValue(1),
          getAwaitingList: vi.fn(),
        },
      };

      const result = await clearAwaitingByReply(deps)('<original-msg-id>');

      expect(deps.awaiting.clearByReply).toHaveBeenCalledWith('<original-msg-id>');
      expect(result).toBe(1);
    });
  });
});
