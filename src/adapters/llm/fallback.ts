/**
 * Multi-tier fallback classifier (#95).
 *
 * Wraps N classifiers in order of preference. For each tier it retries
 * transient errors with jittered exponential backoff; when retries are
 * exhausted (or the error is clearly non-retryable but still tier-local,
 * e.g. a 5xx from one model), it advances to the next tier. A non-retryable
 * *and* non-fallbackable error (auth / bad-request / budget) short-circuits
 * the whole chain.
 *
 * The onTransition callback fires once per tier change and is the single
 * observability hook — container wires it to pino so fallback rate shows
 * up in ops.
 */

import type { Classifier } from '../../core/ports';
import type { Email, EmailBody, Classification } from '../../core/domain';

export type FallbackTier = {
  /** Short label recorded in logs + transitions. */
  label: string;
  classifier: Classifier;
};

export type FallbackTransition = {
  emailId: number;
  fromTier: string;
  toTier: string;
  reason: 'error' | 'budget_exhausted';
  errorMessage: string;
  /** 1-based attempt count within the previous tier before the switch. */
  attemptsInPreviousTier: number;
};

export type FallbackOptions = {
  /** Retries *within* a single tier. Default 2 (so up to 3 attempts). */
  maxRetriesPerTier?: number;
  /** Initial backoff in ms. Doubles each retry, with +/- 25% jitter. */
  baseBackoffMs?: number;
  /** Called once per tier→tier transition. */
  onTransition?: (t: FallbackTransition) => void;
  /** Sleep primitive; override for tests. */
  sleep?: (ms: number) => Promise<void>;
};

type ErrorShape = { message: string; status: number };

function errShape(err: unknown): ErrorShape {
  const message = err instanceof Error ? err.message : String(err);
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : 0;
  return { message, status };
}

/**
 * Transient within the same tier — worth retrying before falling back.
 * 429 and 5xx are clearly transient; network/timeout strings too.
 */
export function isRetryable(err: unknown): boolean {
  const { status, message } = errShape(err);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) return true;
  if (/timeout|ECONN(REFUSED|RESET|ABORTED)|fetch failed|socket hang up|overloaded/i.test(message)) return true;
  return false;
}

/**
 * Worth attempting the next tier. Auth/bad-request/budget are *not* —
 * they indicate a configuration or policy issue the next tier will hit too.
 */
export function isFallbackable(err: unknown): boolean {
  const { status, message } = errShape(err);
  if (status === 401 || status === 403 || status === 400) return false;
  if (/api key not set|daily budget exceeded/i.test(message)) return false;
  return true;
}

function jitteredBackoff(attempt: number, base: number): number {
  const expo = base * Math.pow(2, attempt);
  const jitter = expo * 0.5 * (Math.random() - 0.5); // ±25%
  return Math.max(0, Math.round(expo + jitter));
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createFallbackClassifier(
  tiers: FallbackTier[],
  options: FallbackOptions = {},
): Classifier {
  if (tiers.length === 0) {
    throw new Error('createFallbackClassifier requires at least one tier');
  }
  const maxRetries = options.maxRetriesPerTier ?? 2;
  const baseBackoff = options.baseBackoffMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const onTransition = options.onTransition;

  return {
    async classify(email: Email, body?: EmailBody): Promise<Classification> {
      let lastErr: unknown = new Error('No tiers attempted');

      for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
        const tier = tiers[tierIdx]!;
        let attempt = 0;
        let attemptsInThisTier = 0;

        while (attempt <= maxRetries) {
          attemptsInThisTier = attempt + 1;
          try {
            return await tier.classifier.classify(email, body);
          } catch (err) {
            lastErr = err;
            const retryable = isRetryable(err);
            const fallbackable = isFallbackable(err);

            if (!retryable && !fallbackable) {
              // Auth / budget / 400 — next tier won't help.
              throw err;
            }

            if (retryable && attempt < maxRetries) {
              await sleep(jitteredBackoff(attempt, baseBackoff));
              attempt++;
              continue;
            }

            // Either retries exhausted or the error was non-retryable-but-
            // fallbackable (e.g. model deprecated). Advance to next tier.
            break;
          }
        }

        const nextTier = tiers[tierIdx + 1];
        if (nextTier) {
          onTransition?.({
            emailId: email.id,
            fromTier: tier.label,
            toTier: nextTier.label,
            reason: /budget exhausted/i.test(errShape(lastErr).message) ? 'budget_exhausted' : 'error',
            errorMessage: errShape(lastErr).message,
            attemptsInPreviousTier: attemptsInThisTier,
          });
        }
      }

      // All tiers exhausted — surface the last error so the caller records it.
      throw lastErr;
    },

    getBudget() {
      // Budget/rate-limit display tracks the primary tier only; fallback
      // is invisible to the cost dashboard's daily-usage line. The tier
      // list is guaranteed non-empty by the constructor guard.
      return tiers[0]!.classifier.getBudget();
    },

    getEmailBudget() {
      return tiers[0]!.classifier.getEmailBudget();
    },
  };
}
