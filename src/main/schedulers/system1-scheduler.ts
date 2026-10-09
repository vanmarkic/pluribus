/**
 * Nightly System 1 retrain.
 *
 * Runs `trainSystem1` every `intervalMs` (default 24h), first ~10 minutes
 * after start so the app has settled and the encoder model has had a chance
 * to load. Same shape as the calibration scheduler: returns a stop function
 * the caller invokes on shutdown, never keeps the event loop alive, and a
 * failing run is logged and retried at the next interval.
 *
 * The use case itself keeps heads unarmed when there is too little data, so
 * running it nightly is always safe. While System 1 is disabled in settings
 * a tick only logs and re-arms: the setting is read on every tick, so
 * turning it on takes effect without a restart.
 */

import type { Logger } from 'pino';
import type { System1Status } from '../../core/system1/types';

export type System1Scheduler = {
  stop: () => void;
};

export type System1SchedulerOptions = {
  /** Milliseconds between runs. Default 24h. */
  intervalMs?: number;
  /** Delay before the first run. Default 10 min. */
  initialDelayMs?: number;
  /** pino logger for observability. */
  logger: Logger;
  /** Retrain the heads (`useCases.trainSystem1`). */
  runOnce: () => Promise<System1Status>;
  /** Checked on every tick; training is skipped while this is false (or throws). */
  isEnabled?: () => boolean;
};

const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * ONE_MINUTE_MS;
const TEN_MIN_MS = 10 * ONE_MINUTE_MS;

export function startSystem1Scheduler(options: System1SchedulerOptions): System1Scheduler {
  const intervalMs = options.intervalMs ?? ONE_DAY_MS;
  const initialDelayMs = options.initialDelayMs ?? TEN_MIN_MS;
  const { logger, runOnce } = options;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function enabled(): boolean {
    if (!options.isEnabled) return true;
    try {
      return options.isEnabled();
    } catch {
      return false;
    }
  }

  async function tick() {
    if (cancelled) return;
    try {
      if (!enabled()) {
        logger.info({ component: 'system1-scheduler' }, 'system1.nightly.disabled');
        return;
      }
      const status = await runOnce();
      logger.info(
        {
          component: 'system1-scheduler',
          embeddingModel: status.embeddingModel,
          heads: status.heads.length,
          armed: status.heads.filter((h) => h.armed).map((h) => h.questionId),
        },
        'system1.nightly.trained',
      );
    } catch (err) {
      logger.warn({ component: 'system1-scheduler', err }, 'system1.nightly.error');
    } finally {
      if (!cancelled) schedule(intervalMs);
    }
  }

  function schedule(delayMs: number) {
    timer = setTimeout(tick, delayMs);
    // Don't keep the event loop alive just for retraining — if everything
    // else is idle the whole app can exit cleanly.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  schedule(initialDelayMs);

  return {
    stop() {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}
