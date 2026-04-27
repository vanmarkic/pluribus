import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCalibrationScheduler } from './calibration-scheduler';

const mkLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}) as any;

describe('startCalibrationScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once after initialDelayMs and then every intervalMs', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValue({ fitSize: 100, eceBefore: 0.2, eceAfter: 0.05, fitted: true });
    const scheduler = startCalibrationScheduler({
      logger: mkLogger(),
      runOnce,
      initialDelayMs: 100,
      intervalMs: 500,
    });

    expect(runOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(runOnce).toHaveBeenCalledTimes(1);

    // Yield so the .finally(schedule) runs before the next advance.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(runOnce).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('logs a fitted run', async () => {
    const logger = mkLogger();
    const runOnce = vi
      .fn()
      .mockResolvedValue({ fitSize: 100, eceBefore: 0.2, eceAfter: 0.05, fitted: true });
    startCalibrationScheduler({ logger, runOnce, initialDelayMs: 0, intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ fitSize: 100, eceBefore: 0.2, eceAfter: 0.05 }),
      'calibration.nightly.fitted',
    );
  });

  it('logs a skipped run without error when fitted=false', async () => {
    const logger = mkLogger();
    const runOnce = vi
      .fn()
      .mockResolvedValue({ fitSize: 5, eceBefore: 0, eceAfter: 0, fitted: false });
    startCalibrationScheduler({ logger, runOnce, initialDelayMs: 0, intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ fitSize: 5 }),
      'calibration.nightly.skipped',
    );
  });

  it('logs a warning and keeps scheduling when runOnce throws', async () => {
    const logger = mkLogger();
    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValue({ fitSize: 100, eceBefore: 0.1, eceAfter: 0.05, fitted: true });
    startCalibrationScheduler({ logger, runOnce, initialDelayMs: 0, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'calibration-scheduler' }),
      'calibration.nightly.error',
    );
    // The scheduler should still have rearmed.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('stop() prevents subsequent runs', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValue({ fitSize: 100, eceBefore: 0.2, eceAfter: 0.05, fitted: true });
    const scheduler = startCalibrationScheduler({
      logger: mkLogger(),
      runOnce,
      initialDelayMs: 50,
      intervalMs: 100,
    });
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).not.toHaveBeenCalled();
  });
});
