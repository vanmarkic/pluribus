/**
 * Reply use cases ("Needs your reply")
 *
 * Finds important received emails the user has not answered yet and records
 * what the user did about them (done / snoozed / not important).
 */

import type { Deps } from '../ports';
import type { DigestSettings, ForgottenRepliesResult } from '../domain';

export type FindForgottenRepliesOptions = {
  accountId: number;
  now?: Date;
  /** Overrides on top of the stored digest settings (e.g. for tests or previews). */
  settings?: Partial<DigestSettings>;
};

type ReplyQueryDeps = Pick<Deps, 'replyCandidates' | 'accounts' | 'digestConfig'>;

/**
 * Forgotten replies for one account, ranked best-first.
 * An account with no mail from the user in the lookback window is reported as
 * `sentHealth: 'no-sent-mail'` with no items (the digest is suppressed).
 */
export const findForgottenReplies =
  (deps: ReplyQueryDeps) =>
  async (opts: FindForgottenRepliesOptions): Promise<ForgottenRepliesResult> => {
    // TODO(P1): query deps.replyCandidates, gate + score (core/reply-scoring.ts), cap to maxItems.
    const now = opts.now ?? new Date();
    const account = await deps.accounts.findById(opts.accountId);
    return {
      accountId: opts.accountId,
      accountEmail: account?.email ?? '',
      items: [],
      sentHealth: 'ok',
      generatedAt: now,
    };
  };

/** Forgotten replies for every active account. */
export const listForgottenReplies =
  (deps: ReplyQueryDeps) =>
  async (opts: { now?: Date } = {}): Promise<ForgottenRepliesResult[]> => {
    const accounts = await deps.accounts.findAll();
    const find = findForgottenReplies(deps);
    const results: ForgottenRepliesResult[] = [];
    for (const account of accounts) {
      if (!account.isActive) continue;
      results.push(await find({ accountId: account.id, ...(opts.now ? { now: opts.now } : {}) }));
    }
    return results;
  };

/** The user handled this email: hide it and remember that it did need a reply. */
export const markReplyDone =
  (deps: Pick<Deps, 'replyReminders' | 'signals'>) =>
  async (emailId: number): Promise<void> => {
    await deps.replyReminders.set(emailId, 'done');
    await deps.signals.upsert({
      emailId,
      source: 'user',
      needsReply: 1,
      importance: null,
      folder: null,
      confidence: 1,
      modelVersion: null,
    });
  };

/** Hide this email from the list until `until`. */
export const snoozeReply =
  (deps: Pick<Deps, 'replyReminders'>) =>
  async (emailId: number, until: Date): Promise<void> => {
    if (Number.isNaN(until.getTime())) throw new Error('Invalid snooze time');
    await deps.replyReminders.set(emailId, 'snoozed', until);
  };

/** "Not important": hide it and teach the classifiers it needs no reply. */
export const dismissReply =
  (deps: Pick<Deps, 'replyReminders' | 'signals'>) =>
  async (emailId: number): Promise<void> => {
    await deps.replyReminders.set(emailId, 'dismissed');
    await deps.signals.upsert({
      emailId,
      source: 'user',
      needsReply: 0,
      importance: 1,
      folder: null,
      confidence: 1,
      modelVersion: null,
    });
  };

/**
 * Classify recent, still-unanswered emails that have no signal yet so the
 * digest has something to rank. Does not move mail.
 */
export const backfillReplySignals =
  (_deps: Pick<Deps, 'replyCandidates' | 'accounts' | 'digestConfig' | 'signals'>) =>
  async (_opts: {
    accountId: number;
    limit?: number;
  }): Promise<{
    processed: number;
    skipped: number;
  }> => {
    // TODO(P1): classify candidates without an effective signal via deps.triageClassifier.
    return { processed: 0, skipped: 0 };
  };
