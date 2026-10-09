/**
 * Digest use cases
 *
 * The daily "Needs your reply" digest: compute per-account results, notify
 * natively and email a summary to the user's own address.
 */

import type { Deps } from '../ports';
import type { DigestRunResult, DigestTrigger, ForgottenRepliesResult } from '../domain';

type DigestDeps = Pick<
  Deps,
  'accounts' | 'digestConfig' | 'replyCandidates' | 'notifier' | 'secrets' | 'sender' | 'sync'
>;

/**
 * Run the digest for every account.
 * trigger 'test' always notifies/emails (even with zero items) and marks the subject "[test]".
 */
export const runDailyDigest =
  (_deps: DigestDeps) =>
  async (opts: { now?: Date; trigger: DigestTrigger }): Promise<DigestRunResult> => {
    // TODO(P2): sync when credentials are unlocked, findForgottenReplies, email to self, notify.
    return {
      ranAt: opts.now ?? new Date(),
      trigger: opts.trigger,
      totalItems: 0,
      notified: false,
      accounts: [],
    };
  };

/**
 * Send digest emails that were deferred while credentials were locked.
 * Returns the number of emails sent.
 */
export const sendPendingDigestEmails =
  (_deps: DigestDeps) =>
  async (_opts: { now?: Date } = {}): Promise<number> => {
    // TODO(P2): for each pending account with unlocked credentials, recompute and send.
    return 0;
  };

/**
 * Render the digest email. Pure: never includes body text or snippets, and
 * HTML-escapes every interpolated value.
 */
export const renderDigestEmail = (
  _result: ForgottenRepliesResult,
  _opts: { now: Date },
): { subject: string; text: string; html: string } => {
  // TODO(P2): subject, plain-text and HTML bodies.
  return { subject: '', text: '', html: '' };
};
