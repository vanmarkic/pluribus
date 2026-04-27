/**
 * Nightly calibration scheduler (#96 follow-up).
 *
 * Runs recalibrateConfidence every `intervalMs` (default 24h). Returns
 * a cancel function the container calls on shutdown. Skips when there's
 * insufficient data — the use case itself enforces the minSamples
 * threshold and returns { fitted: false }, which we log at info level.
 */

import type { Logger } from 'pino';

export type CalibrationScheduler = {
  stop: () => void;
};

export type CalibrationSchedulerOptions = {
  /** Milliseconds between runs. Default 24h. */
  intervalMs?: number;
  /** Delay before the first run. Default 5 min — lets startup settle. */
  initialDelayMs?: number;
  /** pino logger for observability. */
  logger: Logger;
  /** Returns { fitSize, eceBefore, eceAfter, fitted }. */
  runOnce: () => Promise<{
    fitSize: number;
    eceBefore: number;
    eceAfter: number;
    fitted: boolean;
  }>;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const FIVE_MIN_MS = 5 * 60 * 1000;

export function startCalibrationScheduler(
  options: CalibrationSchedulerOptions,
): CalibrationScheduler {
  const intervalMs = options.intervalMs ?? ONE_DAY_MS;
  const initialDelayMs = options.initialDelayMs ?? FIVE_MIN_MS;
  const { logger, runOnce } = options;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (cancelled) return;
    try {
      const result = await runOnce();
      if (result.fitted) {
        logger.info(
          {
            component: 'calibration-scheduler',
            fitSize: result.fitSize,
            eceBefore: result.eceBefore,
            eceAfter: result.eceAfter,
          },
          'calibration.nightly.fitted',
        );
      } else {
        logger.info(
          { component: 'calibration-scheduler', fitSize: result.fitSize },
          'calibration.nightly.skipped',
        );
      }
    } catch (err) {
      logger.warn(
        { component: 'calibration-scheduler', err },
        'calibration.nightly.error',
      );
    } finally {
      if (!cancelled) schedule(intervalMs);
    }
  }

  function schedule(delayMs: number) {
    timer = setTimeout(tick, delayMs);
    // Don't keep the event loop alive just for recalibration — if
    // everything else is idle the whole app can exit cleanly.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as any).unref();
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
