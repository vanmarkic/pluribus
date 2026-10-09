/**
 * Daily digest scheduler.
 *
 * Wakes up every minute and runs the digest once per local day, at (or after)
 * the configured HH:MM. "After" is what makes catch-up work: if the app was
 * closed or the machine asleep at 09:00, the first check after launch/wake
 * runs the digest immediately.
 *
 * Comparison is done on local wall-clock time plus a local 'YYYY-MM-DD' key,
 * so DST changes never skip or double-fire a day:
 * - a time inside the skipped spring-forward hour fires as soon as the clock
 *   jumps past it;
 * - the repeated fall-back hour is gated by lastRunDate.
 */

import type { DigestSettings, DigestState, DigestTrigger } from '../../core/domain';

const ONE_MINUTE_MS = 60 * 1000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type DigestScheduler = {
  stop: () => void;
  /** Run the digest now if it is enabled and due (used for launch/wake catch-up). */
  checkNow: () => Promise<void>;
};

export type DigestSchedulerOptions = {
  getSettings: () => DigestSettings;
  getState: () => DigestState;
  setState: (state: DigestState) => void;
  run: (trigger: DigestTrigger) => Promise<unknown>;
  now?: () => Date;
  /** Milliseconds between checks. Default 60 s. */
  tickMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  /** Defaults to console. */
  logger?: { warn: (...args: unknown[]) => void };
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of the given instant in local time. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * True when the digest should run: it has not run on this local day yet and
 * the local wall-clock time has reached `hhmm`. Invalid `hhmm` is never due.
 *
 * lastRunDate is compared for equality (not ordering) on purpose: a date in the
 * future (clock corrected backwards) must not suppress the digest for days.
 */
export function isDue(now: Date, lastRunDate: string | null, hhmm: string): boolean {
  const match = HHMM.exec(hhmm);
  if (!match || Number.isNaN(now.getTime())) return false;
  if (lastRunDate === localDateKey(now)) return false;

  const targetMinutes = Number(match[1]) * 60 + Number(match[2]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= targetMinutes;
}

export function startDigestScheduler(opts: DigestSchedulerOptions): DigestScheduler {
  const nowFn = opts.now ?? (() => new Date());
  const tickMs = opts.tickMs ?? ONE_MINUTE_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  const log = opts.logger ?? console;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function checkNow(): Promise<void> {
    if (stopped || running) return;
    try {
      const settings = opts.getSettings();
      if (!settings.enabled) return;

      const now = nowFn();
      const state = opts.getState();
      if (!isDue(now, state.lastRunDate, settings.time)) return;

      // Claim the day BEFORE awaiting: concurrent ticks / wake-up catch-ups
      // see it as done and cannot double-fire. A failed run is not retried
      // until tomorrow (deferred emails have their own retry path).
      running = true;
      opts.setState({ ...state, lastRunDate: localDateKey(now) });
      await opts.run('scheduled');
    } catch (err) {
      log.warn('[digest-scheduler] Daily digest failed:', err);
    } finally {
      running = false;
    }
  }

  function schedule(): void {
    timer = setTimeoutFn(() => {
      timer = null;
      void checkNow().finally(() => {
        if (!stopped) schedule();
      });
    }, tickMs);
    // Never keep the process alive just for the digest tick.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
    checkNow,
  };
}
