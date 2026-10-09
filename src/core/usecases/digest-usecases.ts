/**
 * Digest use cases
 *
 * The daily "Needs your reply" digest: compute per-account results, notify
 * natively and email a summary to the user's own address.
 *
 * Privacy and credential rules:
 * - Credentials are only read through `secrets.getPasswordIfUnlocked`, which
 *   never prompts. A biometric prompt is allowed solely for scheduled runs
 *   when the user opted in (`allowBiometricPrompt`).
 * - The email goes out through `sender.send` directly (not the `sendEmail` use
 *   case), so nothing is appended to the Sent folder.
 * - Neither the notification nor the email ever contains body text or snippets.
 *
 * Language: the notification and the email follow the system language (French
 * or English, see core/digest-i18n.ts). The locale is read from
 * `digestConfig.getLocale`, which is optional; without it everything is English.
 */

import type { Deps, SmtpConfig } from '../ports';
import type {
  Account,
  DigestAccountOutcome,
  DigestRunResult,
  DigestSettings,
  DigestTrigger,
  ForgottenReply,
  ForgottenRepliesResult,
} from '../domain';
import { digestStrings, resolveDigestLocale, type DigestLocale } from '../digest-i18n';
import { findForgottenReplies } from './reply-usecases';
import { syncMailbox } from './sync-usecases';

type DigestDeps = Pick<
  Deps,
  | 'accounts'
  | 'digestConfig'
  | 'replyCandidates'
  | 'notifier'
  | 'secrets'
  | 'sender'
  | 'sync'
  | 'emails'
  | 'awaiting'
  | 'llmGenerator'
  | 'folders'
>;

const MAX_NOTIFICATION_LINES = 3;
const MAX_NOTIFICATION_LINE_LENGTH = 100;
const HOUR_MS = 60 * 60 * 1000;

// ============================================
// Helpers
// ============================================

/** Same SMTP settings the regular send path derives from an account. */
const smtpConfigFor = (account: Account): SmtpConfig => ({
  host: account.smtpHost,
  port: account.smtpPort,
  secure: account.smtpPort === 465,
});

/** Collapse any whitespace (including newlines) so a value stays on one line. */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const senderLabel = (from: ForgottenReply['from']): string =>
  oneLine(from.name && from.name.trim() ? from.name : from.address);

/**
 * Read-modify-write of the pending list. getState/setState are synchronous, so
 * there is no await between the read and the write and concurrent callers
 * cannot clobber each other (or the scheduler's lastRunDate).
 */
const updatePending = (
  deps: Pick<Deps, 'digestConfig'>,
  update: (ids: number[]) => number[],
): void => {
  const state = deps.digestConfig.getState();
  const next = update([...state.pendingEmailAccountIds]);
  if (
    next.length === state.pendingEmailAccountIds.length &&
    next.every((id, i) => id === state.pendingEmailAccountIds[i])
  ) {
    return;
  }
  deps.digestConfig.setState({ ...state, pendingEmailAccountIds: next });
};

const addPending = (deps: Pick<Deps, 'digestConfig'>, accountId: number): void =>
  updatePending(deps, (ids) => (ids.includes(accountId) ? ids : [...ids, accountId]));

const removePending = (deps: Pick<Deps, 'digestConfig'>, accountId: number): void =>
  updatePending(deps, (ids) => ids.filter((id) => id !== accountId));

/** The language of the digest: the system language when French, English otherwise. */
const localeOf = (deps: Pick<Deps, 'digestConfig'>): DigestLocale =>
  resolveDigestLocale(deps.digestConfig.getLocale?.());

const digestDraft = (
  result: ForgottenRepliesResult,
  account: Account,
  now: Date,
  isTest: boolean,
  locale: DigestLocale,
) => {
  const rendered = renderDigestEmail(result, { now, locale });
  return {
    to: [account.email],
    subject: isTest ? `${digestStrings(locale).testPrefix} ${rendered.subject}` : rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };
};

function notificationBody(
  results: ForgottenRepliesResult[],
  totalItems: number,
  showSubjects: boolean,
  locale: DigestLocale,
): string {
  if (showSubjects && totalItems > 0) {
    return results
      .flatMap((r) => r.items)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_NOTIFICATION_LINES)
      .map((item) =>
        truncate(
          `${senderLabel(item.from)} — ${oneLine(item.subject)}`,
          MAX_NOTIFICATION_LINE_LENGTH,
        ),
      )
      .join('\n');
  }
  return digestStrings(locale).notificationCount(totalItems);
}

// ============================================
// Daily digest
// ============================================

/**
 * Run the digest for every active account.
 * trigger 'test' always notifies/emails (even with zero items) and marks the subject "[test]".
 */
export const runDailyDigest =
  (deps: DigestDeps) =>
  async (opts: { now?: Date; trigger: DigestTrigger }): Promise<DigestRunResult> => {
    const now = opts.now ?? new Date();
    const { trigger } = opts;
    const settings = deps.digestConfig.getSettings();

    const accounts = (await deps.accounts.findAll()).filter((a) => a.isActive);
    const outcomes: DigestAccountOutcome[] = [];
    const results: ForgottenRepliesResult[] = [];

    for (const account of accounts) {
      const progress = { synced: false };
      try {
        const { result, outcome } = await digestAccount(
          deps,
          settings,
          account,
          trigger,
          now,
          progress,
        );
        results.push(result);
        outcomes.push(outcome);
      } catch (err) {
        console.error(`[digest] Failed for account ${account.id}:`, err);
        outcomes.push({
          accountId: account.id,
          itemCount: 0,
          synced: progress.synced,
          email: 'failed',
          sentHealth: 'ok',
        });
      }
    }

    const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);

    let notified = false;
    if ((totalItems > 0 || trigger === 'test') && deps.notifier.isSupported()) {
      try {
        // No onClick: the notifier's default handler opens the Needs-your-reply view.
        const locale = localeOf(deps);
        deps.notifier.notify({
          title: digestStrings(locale).notificationTitle,
          body: notificationBody(results, totalItems, settings.showSubjects, locale),
        });
        notified = true;
      } catch (err) {
        console.error('[digest] Notification failed:', err);
      }
    }

    return { ranAt: now, trigger, totalItems, notified, accounts: outcomes };
  };

async function digestAccount(
  deps: DigestDeps,
  settings: DigestSettings,
  account: Account,
  trigger: DigestTrigger,
  now: Date,
  progress: { synced: boolean },
): Promise<{ result: ForgottenRepliesResult; outcome: DigestAccountOutcome }> {
  // Never prompts. Non-null means the credentials are usable right now.
  const unlocked = (await deps.secrets.getPasswordIfUnlocked(account.email)) !== null;
  // An unattended run may only trigger a biometric prompt if the user opted in.
  const mayPrompt = settings.allowBiometricPrompt && trigger === 'scheduled';

  // 1. Pre-sync so the digest reflects the mailbox right now. A failed sync
  //    (offline, auth) must not stop the digest: it carries on from local data.
  if (unlocked || mayPrompt) {
    try {
      await syncMailbox(deps)(account.id);
      progress.synced = true;
    } catch (err) {
      console.warn(`[digest] Sync failed for account ${account.id}, using local data:`, err);
    }
  }

  // 2. What is waiting for a reply
  const result = await findForgottenReplies(deps)({ accountId: account.id, now });

  // 3. Email to self
  let email: DigestAccountOutcome['email'] = 'skipped';
  const wantsEmail =
    settings.emailToSelf &&
    (result.items.length > 0 || trigger === 'test') &&
    result.sentHealth === 'ok';

  // If the credentials were locked and the sync (which may have prompted) failed,
  // do not risk a second prompt for the send: defer instead. After a successful
  // prompted sync the credentials have been used, so sending needs no new prompt.
  const canSend = unlocked || (mayPrompt && progress.synced);

  if (wantsEmail) {
    if (canSend) {
      try {
        await deps.sender.send(
          account.email,
          smtpConfigFor(account),
          digestDraft(result, account, now, trigger === 'test', localeOf(deps)),
        );
        email = 'sent';
        // A fresh digest supersedes one that was deferred earlier.
        removePending(deps, account.id);
      } catch (err) {
        console.error(`[digest] Sending the digest failed for account ${account.id}:`, err);
        email = 'failed';
        // Unattended run (e.g. right after wake-up, before the network is back):
        // nobody sees the failure, so retry later. Manual/test runs report it instead.
        if (trigger === 'scheduled') addPending(deps, account.id);
      }
    } else {
      addPending(deps, account.id);
      email = 'deferred';
    }
  }

  return {
    result,
    outcome: {
      accountId: account.id,
      itemCount: result.items.length,
      synced: progress.synced,
      email,
      sentHealth: result.sentHealth,
    },
  };
}

// ============================================
// Deferred digest emails
// ============================================

/**
 * Send digest emails that were deferred while credentials were locked.
 * The digest is recomputed at send time, never replayed.
 * Returns the number of emails sent.
 */
export const sendPendingDigestEmails =
  (deps: DigestDeps) =>
  async (opts: { now?: Date } = {}): Promise<number> => {
    const pending = deps.digestConfig.getState().pendingEmailAccountIds;
    if (pending.length === 0) return 0;

    const now = opts.now ?? new Date();
    const settings = deps.digestConfig.getSettings();
    let sent = 0;

    for (const accountId of [...pending]) {
      try {
        const account = await deps.accounts.findById(accountId);
        // Account removed, or the user turned the digest email off: nothing to deliver.
        if (!account || !account.isActive || !settings.enabled || !settings.emailToSelf) {
          removePending(deps, accountId);
          continue;
        }

        // Still locked: keep it pending for the next unlock.
        if ((await deps.secrets.getPasswordIfUnlocked(account.email)) === null) continue;

        const result = await findForgottenReplies(deps)({ accountId, now });
        if (result.items.length === 0 || result.sentHealth !== 'ok') {
          removePending(deps, accountId);
          continue;
        }

        await deps.sender.send(
          account.email,
          smtpConfigFor(account),
          digestDraft(result, account, now, false, localeOf(deps)),
        );
        removePending(deps, accountId);
        sent++;
      } catch (err) {
        // Leave it pending; the next unlock/focus retries.
        console.error(`[digest] Sending deferred digest failed for account ${accountId}:`, err);
      }
    }

    return sent;
  };

// ============================================
// Rendering
// ============================================

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Whole hours the mail has waited, measured from its date when that is usable. */
function ageInHours(item: ForgottenReply, now: Date): number {
  const fromDate = now.getTime() - item.date.getTime();
  const ms = Number.isFinite(fromDate) ? fromDate : item.ageHours * HOUR_MS;
  return Math.max(0, Math.floor(ms / HOUR_MS));
}

/**
 * Render the digest email. Pure: never includes body text or snippets, and
 * HTML-escapes every interpolated value. Inline styles only, no remote content.
 * `locale` defaults to English.
 */
export const renderDigestEmail = (
  result: ForgottenRepliesResult,
  opts: { now: Date; locale?: DigestLocale },
): { subject: string; text: string; html: string } => {
  const strings = digestStrings(opts.locale ?? 'en');
  const { items } = result;
  const count = items.length;
  const subject = strings.emailSubject(count);

  const rows = items.map((item) => {
    const senderName = item.from.name && item.from.name.trim() ? oneLine(item.from.name) : null;
    return {
      sender: senderName ?? oneLine(item.from.address),
      address: senderName ? oneLine(item.from.address) : null,
      subject: oneLine(item.subject) || strings.noSubject,
      age: strings.age(ageInHours(item, opts.now)),
      importance: strings.importance[item.importance] ?? strings.importance[2],
      // Built from structured fields, not from item.reason (which is English UI text).
      reason: strings.reason(item),
    };
  });
  const account = oneLine(result.accountEmail);

  // ---- plain text ----
  const textLines: string[] = [`${strings.heading(count)} — ${account}`, ''];
  if (rows.length === 0) {
    textLines.push(strings.empty, '');
  }
  rows.forEach((row, i) => {
    textLines.push(
      `${i + 1}. ${row.sender}${row.address ? ` <${row.address}>` : ''}`,
      `   ${row.subject}`,
      `   ${row.age} · ${row.importance}${row.reason ? ` · ${row.reason}` : ''}`,
      '',
    );
  });
  textLines.push('--', strings.footer, '');
  const text = textLines.join('\n');

  // ---- HTML ----
  const itemHtml = rows
    .map(
      (row) =>
        `<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb;">` +
        `<div style="font-size:15px;font-weight:600;color:#111827;">${escapeHtml(row.subject)}</div>` +
        `<div style="font-size:13px;color:#374151;margin-top:2px;">${escapeHtml(row.sender)}` +
        `${row.address ? ` &lt;${escapeHtml(row.address)}&gt;` : ''}</div>` +
        `<div style="font-size:12px;color:#6b7280;margin-top:4px;">` +
        `${escapeHtml(row.age)} · ${escapeHtml(row.importance)}` +
        `${row.reason ? ` · ${escapeHtml(row.reason)}` : ''}</div>` +
        `</td></tr>`,
    )
    .join('');
  const emptyHtml =
    rows.length === 0
      ? `<p style="font-size:14px;color:#374151;">${escapeHtml(strings.empty)}</p>`
      : '';

  const html =
    `<!doctype html><html lang="${strings.htmlLang}"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;">` +
    `<h1 style="font-size:18px;color:#111827;margin:0 0 4px;">${escapeHtml(strings.heading(count))}</h1>` +
    `<div style="font-size:13px;color:#6b7280;margin-bottom:12px;">${escapeHtml(account)}</div>` +
    emptyHtml +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemHtml}</table>` +
    `<p style="font-size:12px;color:#6b7280;margin-top:20px;border-top:1px solid #e5e7eb;padding-top:12px;">${escapeHtml(strings.footer)}</p>` +
    `</div></body></html>`;

  return { subject, text, html };
};
