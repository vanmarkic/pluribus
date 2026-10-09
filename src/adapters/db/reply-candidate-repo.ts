/**
 * Reply Candidate Repository
 *
 * Finds received emails that look unanswered (no reply from the user) so the
 * "needs your reply" digest can rank them.
 *
 * Facts this relies on (see P0 notes):
 * - `emails.date` is an ISO-8601 string from `Date.toISOString()`, so string
 *   comparison orders correctly;
 * - "sent by me" has no flag: it is `lower(from_address) = lower(account.email)`
 *   in any folder;
 * - `folders.path` identifies INBOX / Planning / Review.
 */

import Database from 'better-sqlite3';
import type { ReplyCandidateQuery, ReplyCandidateRepo } from '../../core/ports';
import type { ReplyCandidate } from '../../core/domain';
import { createSignalRepo } from './email-signals-repo';
import { mapEmail } from './mappers';

/**
 * A reply cannot predate the mail it answers, so only my mail from slightly
 * before the lookback start can matter (the margin absorbs clock skew).
 */
const SENT_LOOKBACK_MARGIN_MS = 24 * 60 * 60 * 1000;

/** Does the stored `to_addresses` JSON contain this exact address (case-insensitive)? */
function recipientsInclude(toAddresses: unknown, address: string): boolean {
  if (typeof toAddresses !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(toAddresses);
    if (!Array.isArray(parsed)) return false;
    const needle = address.trim().toLowerCase();
    return parsed.some((entry) => {
      const value =
        typeof entry === 'string'
          ? entry
          : entry && typeof (entry as { address?: unknown }).address === 'string'
            ? (entry as { address: string }).address
            : '';
      return value.trim().toLowerCase() === needle;
    });
  } catch {
    return false;
  }
}

export function createReplyCandidateRepo(getDb: () => Database.Database): ReplyCandidateRepo {
  const signals = createSignalRepo(getDb);

  return {
    async listUnanswered(q: ReplyCandidateQuery): Promise<ReplyCandidate[]> {
      if (q.folders.length === 0) return [];

      const params: Record<string, string | number> = {
        accountId: q.accountId,
        me: q.myAddress,
        since: q.since.toISOString(),
        until: q.until.toISOString(),
        now: q.now.toISOString(),
        sentSince: new Date(q.since.getTime() - SENT_LOOKBACK_MARGIN_MS).toISOString(),
        limit: q.limit !== undefined ? Math.max(0, Math.floor(q.limit)) : -1,
      };
      const folderPlaceholders = q.folders.map((folder, i) => {
        params[`folder${i}`] = folder.toLowerCase();
        return `@folder${i}`;
      });

      // `sent` holds my mail once; each candidate is anti-joined against it.
      // A candidate is answered when a mail from me
      //  - has In-Reply-To = its Message-ID, or
      //  - lists its Message-ID in References (instr: exact, no LIKE wildcards), or
      //  - belongs to the same thread and is dated at or after it
      //    (an EARLIER mail from me in the thread does not count).
      const rows = getDb()
        .prepare(
          `
        WITH sent AS MATERIALIZED (
          SELECT in_reply_to, "references" AS refs, thread_id, date
          FROM emails
          WHERE account_id = @accountId
            AND date >= @sentSince
            AND lower(from_address) = lower(@me)
        )
        SELECT e.*, f.path AS folder_path
        FROM emails e
        JOIN folders f ON f.id = e.folder_id
        WHERE e.account_id = @accountId
          AND lower(f.path) IN (${folderPlaceholders.join(', ')})
          AND lower(e.from_address) != lower(@me)
          AND (e.list_unsubscribe IS NULL OR e.list_unsubscribe = '')
          AND e.date >= @since
          AND e.date <= @until
          AND NOT EXISTS (
            SELECT 1 FROM sent s
            WHERE (
                e.message_id IS NOT NULL AND e.message_id != '' AND (
                  s.in_reply_to = e.message_id
                  OR instr(lower(s.refs), lower(e.message_id)) > 0
                )
              )
              OR (
                e.thread_id IS NOT NULL AND e.thread_id != ''
                AND s.thread_id = e.thread_id
                AND s.date >= e.date
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM reply_reminders r
            WHERE r.email_id = e.id
              AND (
                r.state IN ('done', 'dismissed')
                OR (r.state = 'snoozed' AND r.snoozed_until > @now)
              )
          )
        ORDER BY e.date DESC, e.id DESC
        LIMIT @limit
      `,
        )
        .all(params) as any[];

      const candidates: ReplyCandidate[] = [];
      for (const row of rows) {
        let email;
        try {
          email = mapEmail(row);
        } catch (error) {
          // One unreadable row must not hide every other reminder.
          console.warn(`reply-candidates: skipping email ${row.id}:`, error);
          continue;
        }
        candidates.push({
          email,
          folderPath: row.folder_path as string,
          signal: await signals.getEffective(email.id),
          toIncludesMe: recipientsInclude(row.to_addresses, q.myAddress),
        });
      }
      return candidates;
    },

    async countSentByMe(accountId, myAddress, since) {
      const row = getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM emails
           WHERE account_id = ? AND lower(from_address) = lower(?) AND date >= ?`,
        )
        .get(accountId, myAddress, since.toISOString()) as { n: number };
      return row.n;
    },
  };
}
