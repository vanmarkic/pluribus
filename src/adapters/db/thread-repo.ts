/**
 * Thread Repository
 *
 * Provides database queries for grouping emails into threads.
 * - getThreadedList: Returns ThreadSummary objects grouped by thread_id
 * - getThreadMessages: Returns all emails in a thread sorted chronologically
 */

import { getDb } from './connection';
import { mapEmail } from './mappers';
import type { Email, ThreadSummary } from '../../core/domain';

export type ThreadRepo = {
  getThreadedList(accountId: number, folderId: number): Promise<ThreadSummary[]>;
  getThreadMessages(threadId: string): Promise<Email[]>;
};

export function createThreadRepo(): ThreadRepo {
  return {
    async getThreadedList(accountId: number, folderId: number): Promise<ThreadSummary[]> {
      const db = getDb();

      // Get thread summaries with aggregated data
      // Uses CTE to compute thread-level statistics, then joins to get latest email info
      const rows = db.prepare(`
        WITH thread_data AS (
          SELECT
            COALESCE(thread_id, message_id) as tid,
            COUNT(*) as message_count,
            SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_count,
            MAX(date) as latest_date
          FROM emails
          WHERE account_id = ? AND folder_id = ?
          GROUP BY COALESCE(thread_id, message_id)
        ),
        latest_emails AS (
          SELECT e.*, td.message_count, td.unread_count, td.latest_date as thread_latest_date,
            ROW_NUMBER() OVER (PARTITION BY COALESCE(e.thread_id, e.message_id) ORDER BY e.date DESC) as rn
          FROM emails e
          JOIN thread_data td ON COALESCE(e.thread_id, e.message_id) = td.tid
          WHERE e.account_id = ? AND e.folder_id = ?
        )
        SELECT * FROM latest_emails WHERE rn = 1
        ORDER BY thread_latest_date DESC
      `).all(accountId, folderId, accountId, folderId);

      return rows.map((row: any) => {
        const email = mapEmail(row);
        return {
          threadId: row.thread_id || row.message_id,
          subject: email.subject,
          snippet: email.snippet,
          participants: [email.from], // Simplified - could aggregate all participants
          messageCount: row.message_count,
          unreadCount: row.unread_count,
          latestDate: email.date,
          isLatestUnread: !email.isRead,
          emails: [],
        };
      });
    },

    async getThreadMessages(threadId: string): Promise<Email[]> {
      const db = getDb();

      const rows = db.prepare(`
        SELECT * FROM emails
        WHERE thread_id = ? OR message_id = ?
        ORDER BY date ASC
      `).all(threadId, threadId);

      return rows.map(mapEmail);
    },
  };
}
