/**
 * Sender history for System 1 features.
 *
 * `priorRepliesToSender` = how many mails the account owner has SENT to an
 * address. "Sent by me" has no flag in the schema: it is
 * `lower(from_address) = lower(account.email)` in any folder. Recipients are
 * stored as a JSON array (strings, or `{address}` objects); matching on the
 * quoted lowercase address with `instr` is exact (no LIKE wildcards, and
 * `a@b.com` does not match `xa@b.com`).
 *
 * The training side of System 1 must use the same definition, or the feature
 * would mean different things at training and at inference.
 */

import type Database from 'better-sqlite3';

export function createPriorRepliesCounter(
  getDb: () => Database.Database,
): (accountId: number, address: string) => Promise<number> {
  return async (accountId, address) => {
    const needle = address.trim().toLowerCase();
    if (needle === '') return 0;
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n
         FROM emails e
         WHERE e.account_id = @accountId
           AND lower(e.from_address) = (SELECT lower(email) FROM accounts WHERE id = @accountId)
           AND instr(lower(e.to_addresses), @needle) > 0`,
      )
      .get({ accountId, needle: `"${needle}"` }) as { n: number } | undefined;
    return row?.n ?? 0;
  };
}
