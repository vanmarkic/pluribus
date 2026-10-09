/**
 * Sender history for System 1 features.
 *
 * `priorRepliesToSender` = how many mails the account owner has SENT to an
 * address. "Sent by me" has no flag in the schema: it is
 * `lower(from_address) = lower(account.email)` in any folder. Recipients are
 * stored as a JSON array (strings, or `{address}` objects).
 *
 * The training side of System 1 (adapters/db/system1-training-repo.ts) must use
 * the same definition, or the feature would mean different things at training
 * and at inference. It is: mail from the account address, with a usable date,
 * strictly BEFORE the email in question, whose recipients (trimmed,
 * case-insensitive, exact) include the sender. This is tested against the
 * training repo in src/__tests__/system1-pipeline.test.ts.
 *
 * `before` is that email's date. Leave it out to count everything sent so far
 * (the right answer for mail that has just arrived).
 */

import type Database from 'better-sqlite3';

export type PriorRepliesCounter = (
  accountId: number,
  address: string,
  /** Only count mail sent strictly before this time. */
  before?: Date,
) => Promise<number>;

function recipientsOf(json: unknown): string[] {
  if (typeof json !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): string[] => {
      if (typeof entry === 'string') return [entry];
      const address = (entry as { address?: unknown } | null)?.address;
      return typeof address === 'string' ? [address] : [];
    });
  } catch {
    return [];
  }
}

export function createPriorRepliesCounter(getDb: () => Database.Database): PriorRepliesCounter {
  return async (accountId, address, before) => {
    const needle = address.trim().toLowerCase();
    if (needle === '') return 0;

    // SQL narrows to mail that mentions the address at all (SQLite's lower() only folds
    // ASCII, so fold the probe the same way); the exact recipient match happens below.
    const probe = address.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
    const rows = getDb()
      .prepare(
        `SELECT e.date, e.to_addresses
         FROM emails e
         WHERE e.account_id = @accountId
           AND lower(e.from_address) = (SELECT lower(email) FROM accounts WHERE id = @accountId)
           AND instr(lower(e.to_addresses), @probe) > 0`,
      )
      .all({ accountId, probe }) as { date: string; to_addresses: string }[];

    const limit = before !== undefined ? before.getTime() : Number.NaN;
    const upTo = Number.isNaN(limit) ? Number.POSITIVE_INFINITY : limit;

    let count = 0;
    for (const row of rows) {
      const sentAt = Date.parse(row.date);
      if (Number.isNaN(sentAt) || sentAt >= upTo) continue;
      if (recipientsOf(row.to_addresses).some((r) => r.trim().toLowerCase() === needle)) count++;
    }
    return count;
  };
}
