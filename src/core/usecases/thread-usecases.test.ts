/**
 * Thread Use Cases Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { getThreadedEmails, getThreadMessages } from './thread-usecases';
import type { ThreadSummary, Email } from '../domain';

describe('thread usecases', () => {
  describe('getThreadedEmails', () => {
    it('calls thread repo with correct params', async () => {
      const mockThreads: ThreadSummary[] = [{
        threadId: '<thread1>',
        subject: 'Test',
        snippet: 'Hello',
        participants: [{ address: 'test@test.com', name: 'Test' }],
        messageCount: 2,
        unreadCount: 1,
        latestDate: new Date(),
        isLatestUnread: true,
        emails: [],
      }];

      const deps = {
        threads: {
          getThreadedList: vi.fn().mockResolvedValue(mockThreads),
          getThreadMessages: vi.fn(),
        },
      };

      const result = await getThreadedEmails(deps)(1, 1);

      expect(deps.threads.getThreadedList).toHaveBeenCalledWith(1, 1);
      expect(result).toEqual(mockThreads);
    });
  });

  describe('getThreadMessages', () => {
    it('calls thread repo with thread id', async () => {
      const mockEmails: Email[] = [];

      const deps = {
        threads: {
          getThreadedList: vi.fn(),
          getThreadMessages: vi.fn().mockResolvedValue(mockEmails),
        },
      };

      const result = await getThreadMessages(deps)('<thread1>');

      expect(deps.threads.getThreadMessages).toHaveBeenCalledWith('<thread1>');
      expect(result).toEqual(mockEmails);
    });
  });
});
