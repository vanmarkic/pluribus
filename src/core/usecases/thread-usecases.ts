/**
 * Thread Use Cases
 *
 * Use cases for email threading operations:
 * - getThreadedEmails: Get emails grouped by thread
 * - getThreadMessages: Get all messages in a thread
 */

import type { ThreadRepo } from '../../adapters/db/thread-repo';
import type { ThreadSummary, Email } from '../domain';

type Deps = {
  threads: ThreadRepo;
};

export const getThreadedEmails = (deps: Pick<Deps, 'threads'>) =>
  async (accountId: number, folderId: number): Promise<ThreadSummary[]> => {
    return deps.threads.getThreadedList(accountId, folderId);
  };

export const getThreadMessages = (deps: Pick<Deps, 'threads'>) =>
  async (threadId: string): Promise<Email[]> => {
    return deps.threads.getThreadMessages(threadId);
  };
