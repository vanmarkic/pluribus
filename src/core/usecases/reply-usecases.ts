/**
 * Reply use cases ("Needs your reply")
 *
 * Finds important received emails the user has not answered yet and records
 * what the user did about them (done / snoozed / not important).
 */

import type { Deps } from '../ports';
import type { DigestSettings, ForgottenRepliesResult } from '../domain';
import { rankCandidates } from '../reply-scoring';
import { fetchBodyPreview, isHumanCandidate, mayUseBodyPreview } from './body-preview';

export type FindForgottenRepliesOptions = {
  accountId: number;
  now?: Date;
  /** Overrides on top of the stored digest settings (e.g. for tests or previews). */
  settings?: Partial<DigestSettings>;
};

type ReplyQueryDeps = Pick<Deps, 'replyCandidates' | 'accounts' | 'digestConfig'>;

/** Folders that hold mail the user is expected to deal with. */
export const REPLY_FOLDERS = ['INBOX', 'Planning', 'Review'] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Safety net for the candidate query (gating happens after it, so no tight cap here). */
const MAX_CANDIDATES = 5000;

/**
 * Forgotten replies for one account, ranked best-first.
 * An account with no mail from the user in the lookback window is reported as
 * `sentHealth: 'no-sent-mail'` with no items (the digest is suppressed).
 */
export const findForgottenReplies =
  (deps: ReplyQueryDeps) =>
  async (opts: FindForgottenRepliesOptions): Promise<ForgottenRepliesResult> => {
    const now = opts.now ?? new Date();
    const account = await deps.accounts.findById(opts.accountId);
    if (!account) {
      return {
        accountId: opts.accountId,
        accountEmail: '',
        items: [],
        sentHealth: 'ok',
        generatedAt: now,
      };
    }

    const settings: DigestSettings = { ...deps.digestConfig.getSettings(), ...opts.settings };
    const since = new Date(now.getTime() - settings.lookbackDays * DAY_MS);
    const until = new Date(now.getTime() - settings.graceHours * HOUR_MS);

    const base = { accountId: account.id, accountEmail: account.email, generatedAt: now };

    // No outgoing mail in the window means the Sent folder is probably not
    // synced: every mail would look unanswered, so say nothing.
    const sentCount = await deps.replyCandidates.countSentByMe(account.id, account.email, since);
    if (sentCount === 0) {
      return { ...base, items: [], sentHealth: 'no-sent-mail' };
    }

    const candidates = await deps.replyCandidates.listUnanswered({
      accountId: account.id,
      myAddress: account.email,
      since,
      until,
      folders: REPLY_FOLDERS,
      now,
      limit: MAX_CANDIDATES,
    });

    const items = rankCandidates(candidates, {
      now,
      graceHours: settings.graceHours,
      maxItems: settings.maxItems,
      minImportance: settings.minImportance,
    });
    return { ...base, items, sentHealth: 'ok' };
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

type BackfillDeps = Pick<
  Deps,
  | 'replyCandidates'
  | 'accounts'
  | 'digestConfig'
  | 'emails'
  | 'sync'
  | 'config'
  | 'patternMatcher'
  | 'triageClassifier'
  | 'trainingRepo'
>;

const BACKFILL_DEFAULT_LIMIT = 50;

/**
 * Classify recent, still-unanswered emails that have no signal yet so the
 * digest has something to rank. Does not move mail: the container wraps
 * `triageClassifier` with `withSignalRecording`, which stores what the model
 * says. Stops at the first error; `skipped` counts candidates that already had
 * a signal.
 */
export const backfillReplySignals =
  (deps: BackfillDeps) =>
  async (opts: {
    accountId: number;
    limit?: number;
  }): Promise<{
    processed: number;
    skipped: number;
  }> => {
    const account = await deps.accounts.findById(opts.accountId);
    if (!account) return { processed: 0, skipped: 0 };

    const limit = Math.max(0, Math.floor(opts.limit ?? BACKFILL_DEFAULT_LIMIT));
    const now = new Date();
    const settings = deps.digestConfig.getSettings();

    // Ignore the grace period: we want signals ready for mail about to age in.
    const candidates = await deps.replyCandidates.listUnanswered({
      accountId: account.id,
      myAddress: account.email,
      since: new Date(now.getTime() - settings.lookbackDays * DAY_MS),
      until: now,
      folders: REPLY_FOLDERS,
      now,
    });

    const unsignalled = candidates.filter((c) => c.signal === null);
    const skipped = candidates.length - unsignalled.length;
    const allowPreview = mayUseBodyPreview(deps.config.getLLMConfig());

    let processed = 0;
    for (const candidate of unsignalled.slice(0, limit)) {
      const { email } = candidate;
      try {
        const hint = deps.patternMatcher.match(email);
        const examples = await deps.trainingRepo.getRelevantExamples(email.accountId, email, 30);
        const bodyPreview =
          allowPreview && isHumanCandidate(email, account.email)
            ? await fetchBodyPreview(deps)(email.id)
            : undefined;
        if (bodyPreview !== undefined) {
          await deps.triageClassifier.classify(email, hint, examples, { bodyPreview });
        } else {
          await deps.triageClassifier.classify(email, hint, examples);
        }
        processed++;
      } catch (error) {
        console.warn(`Reply signal backfill stopped at email ${email.id}:`, error);
        break;
      }
    }
    return { processed, skipped };
  };
