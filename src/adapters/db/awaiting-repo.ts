/**
 * Awaiting Reply Repository
 *
 * Manages the "Awaiting Reply" tracking for emails.
 * Task 8: Awaiting Repository
 *
 * Key behaviors:
 * - markAwaiting: Sets awaiting_reply flag with timestamp
 * - clearAwaiting: Clears the awaiting_reply flag
 * - clearByReply: Auto-clear when a reply is received (matched by message_id)
 * - getAwaitingList: Virtual folder query for "Awaiting Reply" view
 */

import { getDb } from './connection';
import { mapEmail } from './mappers';
import type { Email } from '../../core/domain';

export type AwaitingRepo = {
  markAwaiting(emailId: number): Promise<void>;
  clearAwaiting(emailId: number): Promise<void>;
  clearByReply(inReplyToMessageId: string): Promise<number | null>;
  getAwaitingList(accountId: number): Promise<Email[]>;
};

export function createAwaitingRepo(): AwaitingRepo {
  return {
    async markAwaiting(emailId: number): Promise<void> {
      const db = getDb();
      db.prepare(`
        UPDATE emails
        SET awaiting_reply = 1, awaiting_reply_since = datetime('now')
        WHERE id = ?
      `).run(emailId);
    },

    async clearAwaiting(emailId: number): Promise<void> {
      const db = getDb();
      db.prepare(`
        UPDATE emails
        SET awaiting_reply = 0, awaiting_reply_since = NULL
        WHERE id = ?
      `).run(emailId);
    },

    async clearByReply(inReplyToMessageId: string): Promise<number | null> {
      const db = getDb();

      const result = db.prepare(`
        UPDATE emails
        SET awaiting_reply = 0, awaiting_reply_since = NULL
        WHERE message_id = ? AND awaiting_reply = 1
        RETURNING id
      `).get(inReplyToMessageId) as { id: number } | undefined;

      return result?.id ?? null;
    },

    async getAwaitingList(accountId: number): Promise<Email[]> {
      const db = getDb();

      const rows = db.prepare(`
        SELECT * FROM emails
        WHERE account_id = ? AND awaiting_reply = 1
        ORDER BY awaiting_reply_since DESC
      `).all(accountId);

      return rows.map(mapEmail);
    },
  };
}
