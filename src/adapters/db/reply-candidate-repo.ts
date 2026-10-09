/**
 * Reply Candidate Repository
 *
 * Finds received emails that look unanswered (no later mail from the user in
 * the thread) so the "needs your reply" digest can rank them.
 */

import Database from 'better-sqlite3';
import type { ReplyCandidateRepo } from '../../core/ports';

export function createReplyCandidateRepo(_getDb: () => Database.Database): ReplyCandidateRepo {
  return {
    // TODO(P1): implement the unanswered-received-mail query (see contracts.md).
    async listUnanswered() {
      return [];
    },

    // TODO(P1): count mail sent by the user since `since` (Sent-folder health check).
    async countSentByMe() {
      return 0;
    },
  };
}
