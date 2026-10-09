/**
 * Reply scoring ("Needs your reply")
 *
 * Pure functions that decide which unanswered emails deserve a reminder and
 * in what order: gating, the no-signal heuristic, ranking and the short
 * human-readable reason. No dependencies, no I/O.
 *
 * Gate (when a classifier/user signal exists):
 *   importance >= 3 (important) AND needsReply >= 0.6
 * Gate (no usable signal): the cheap text heuristic from awaiting.ts says the
 * mail asks something AND the sender looks like a person - treated as
 * importance 3 / needsReply 0.6.
 *
 * Score = importanceWeight(importance) * needsReply * ageFactor(age) [* 1.1 if
 * the user is a direct recipient]. Higher first.
 */

import type { ForgottenReply, ImportanceLevel, ReplyCandidate } from './domain';
import { quickCheck } from './usecases/awaiting';

// ============================================
// Constants
// ============================================

/** Signals below this importance (3 = "important") never surface. */
export const GATE_MIN_IMPORTANCE: ImportanceLevel = 3;
/** Signals below this needs-reply probability never surface. */
export const GATE_MIN_NEEDS_REPLY = 0.6;

/** Values assumed when only the text heuristic backs an item. */
export const HEURISTIC_IMPORTANCE: ImportanceLevel = 3;
export const HEURISTIC_NEEDS_REPLY = 0.6;

/** Direct recipients (To:) rank 10% higher than Cc/list mail. */
export const TO_ME_BOOST = 1.1;

/** Age factor ceiling, reached after AGE_RAMP_END_HOURS. */
export const AGE_FACTOR_MAX = 1.5;
/** 7 days: older mail does not get any more urgent. */
export const AGE_RAMP_END_HOURS = 7 * 24;

const HOUR_MS = 3_600_000;

/** Weight per importance level. Levels below the gate only matter for ordering ties. */
const IMPORTANCE_WEIGHTS: Record<ImportanceLevel, number> = {
  1: 0.2,
  2: 0.5,
  3: 1,
  4: 1.8,
};

// ============================================
// Building blocks
// ============================================

export function importanceWeight(importance: ImportanceLevel): number {
  return IMPORTANCE_WEIGHTS[importance];
}

/**
 * Multiplier that favours mail that has waited longer. 1.0 until the grace
 * period ends, then grows linearly to {@link AGE_FACTOR_MAX} (1.5) at 7 days
 * and stays flat afterwards.
 */
export function ageFactor(ageHours: number, graceHours = 0): number {
  if (!(ageHours > graceHours)) return 1;
  const span = AGE_RAMP_END_HOURS - graceHours;
  if (span <= 0) return AGE_FACTOR_MAX;
  const t = Math.min(1, (ageHours - graceHours) / span);
  return 1 + (AGE_FACTOR_MAX - 1) * t;
}

/**
 * Local parts that belong to machines, not people (English and French). Matches
 * the bare name and common suffixed variants (`notifications-noreply`,
 * `noreply+id`, `bounces.x`, `ne-pas-repondre`, `pas_de_reponse`). Tested
 * against the lower-cased, accent-stripped local part, so `ne-pas-répondre`
 * matches too.
 */
const AUTOMATED_LOCAL_PART =
  /(^|[-_.+])(no[-_.]?reply|do[-_.]?not[-_.]?reply|ne[-_.]?pas[-_.]?repondre|pas[-_.]?de[-_.]?reponse|notifications?|notify|mailer[-_.]?daemon|postmaster|bounces?)([-_.+]|$)/;

function foldLocalPart(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** True when the address does not look like a no-reply / notification / system sender. */
export function looksPersonalSender(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return false;
  return !AUTOMATED_LOCAL_PART.test(foldLocalPart(address.slice(0, at)));
}

/** "5 hours ago", "1 day ago", "3 weeks ago" - never anything from the mail itself. */
export function describeAge(ageHours: number): string {
  const hours = Math.max(0, Math.floor(ageHours));
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

// ============================================
// Scoring
// ============================================

export type ScoringContext = {
  now: Date;
  /** Grace period used for the candidate query; the age factor starts here. */
  graceHours: number;
};

function importanceLabel(importance: ImportanceLevel): string {
  return importance >= 4 ? 'Critical' : 'Important';
}

/** Who produced the signal, for the reason line. */
function signalReason(signal: NonNullable<ReplyCandidate['signal']>, importance: ImportanceLevel) {
  switch (signal.source) {
    case 'user':
      return 'You marked this as needing a reply';
    case 'system1':
      return `Marked ${importanceLabel(importance).toLowerCase()} by the on-device model`;
    case 'system2': {
      const who = !signal.modelVersion
        ? 'AI'
        : /claude/i.test(signal.modelVersion)
          ? 'Claude'
          : 'local model';
      return `${importanceLabel(importance)} · flagged by ${who}`;
    }
  }
}

/**
 * Gate and score one candidate. Returns null when the mail should not be
 * surfaced. The reason is built from fixed phrases only (never subject or
 * body text).
 */
export function scoreCandidate(
  candidate: ReplyCandidate,
  ctx: ScoringContext,
): ForgottenReply | null {
  const { email, signal } = candidate;
  const ageHours = Math.max(0, (ctx.now.getTime() - email.date.getTime()) / HOUR_MS);

  let importance: ImportanceLevel;
  let needsReply: number;
  let basis: ForgottenReply['basis'];
  let reason: string;

  if (signal && signal.needsReply !== null) {
    // A "done" mark from the user stores needsReply=1 without importance: the
    // user said it needs a reply, so treat it as important. Machine signals
    // with no importance count as normal (they do not pass the gate).
    importance = signal.importance ?? (signal.source === 'user' ? 3 : 2);
    needsReply = signal.needsReply;
    if (importance < GATE_MIN_IMPORTANCE || needsReply < GATE_MIN_NEEDS_REPLY) return null;
    basis = 'signal';
    reason = signalReason(signal, importance);
  } else {
    if (!looksPersonalSender(email.from.address)) return null;
    if (quickCheck(`${email.subject}\n${email.snippet}`) !== true) return null;
    importance = HEURISTIC_IMPORTANCE;
    needsReply = HEURISTIC_NEEDS_REPLY;
    basis = 'heuristic';
    reason = `Asked you a question ${describeAge(ageHours)}`;
  }

  const score =
    importanceWeight(importance) *
    needsReply *
    ageFactor(ageHours, ctx.graceHours) *
    (candidate.toIncludesMe ? TO_ME_BOOST : 1);

  return {
    emailId: email.id,
    accountId: email.accountId,
    from: { address: email.from.address, name: email.from.name },
    subject: email.subject,
    date: email.date,
    ageHours,
    folderPath: candidate.folderPath,
    needsReply,
    importance,
    score,
    basis,
    signalSource: basis === 'signal' && signal ? signal.source : null,
    reason,
  };
}

/**
 * Gate, score and sort candidates best-first, keeping at most `maxItems`.
 * Ties: signal-backed before heuristic, then the longer-waiting mail, then
 * the lower email id (so the order is deterministic).
 */
export function rankCandidates(
  candidates: readonly ReplyCandidate[],
  ctx: ScoringContext & { maxItems: number },
): ForgottenReply[] {
  const scored: ForgottenReply[] = [];
  for (const candidate of candidates) {
    const item = scoreCandidate(candidate, ctx);
    if (item) scored.push(item);
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.basis === b.basis ? 0 : a.basis === 'signal' ? -1 : 1) ||
      b.ageHours - a.ageHours ||
      a.emailId - b.emailId,
  );
  const cap = Number.isFinite(ctx.maxItems) ? Math.max(0, Math.floor(ctx.maxItems)) : scored.length;
  return scored.slice(0, cap);
}
