import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startSystem1Scheduler } from './system1-scheduler';
import type { System1Status } from '../../core/system1/types';

const mkLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }) as any;

const head = (questionId: string, armed: boolean, trainSize = 120) => ({
  questionId,
  armed,
  version: 3,
  coverage: armed ? 0.6 : 0.1,
  agreement: 0.93,
  disagreementUpperBound: 0.04,
  trainSize,
  trainedAt: new Date('2026-06-01T03:00:00Z'),
});

const status = (armed: boolean[] = [true, false, false]): System1Status => ({
  embeddingModel: 'Xenova/multilingual-e5-small',
  heads: [head('folder', armed[0]!), head('needsReply', armed[1]!), head('importance', armed[2]!)],
});

describe('startSystem1Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults: first run after about 10 minutes, then every 24 hours', async () => {
    const runOnce = vi.fn().mockResolvedValue(status());
    const scheduler = startSystem1Scheduler({ logger: mkLogger(), runOnce });

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(runOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('runs once after initialDelayMs and then every intervalMs', async () => {
    const runOnce = vi.fn().mockResolvedValue(status());
    const scheduler = startSystem1Scheduler({
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

  it('logs how many heads are armed after a run', async () => {
    const logger = mkLogger();
    const runOnce = vi.fn().mockResolvedValue(status([true, true, false]));
    startSystem1Scheduler({ logger, runOnce, initialDelayMs: 0, intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'system1-scheduler',
        embeddingModel: 'Xenova/multilingual-e5-small',
        armed: ['folder', 'needsReply'],
        heads: 3,
      }),
      'system1.nightly.trained',
    );
  });

  it('logs a warning and keeps scheduling when training throws', async () => {
    const logger = mkLogger();
    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('model not downloaded'))
      .mockResolvedValue(status());
    startSystem1Scheduler({ logger, runOnce, initialDelayMs: 0, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'system1-scheduler' }),
      'system1.nightly.error',
    );
    // The scheduler should still have rearmed.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('stop() prevents subsequent runs', async () => {
    const runOnce = vi.fn().mockResolvedValue(status());
    const scheduler = startSystem1Scheduler({
      logger: mkLogger(),
      runOnce,
      initialDelayMs: 50,
      intervalMs: 100,
    });
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('skips training while System 1 is disabled, and picks up when it is turned on', async () => {
    const logger = mkLogger();
    let enabled = false;
    const runOnce = vi.fn().mockResolvedValue(status());
    startSystem1Scheduler({
      logger,
      runOnce,
      isEnabled: () => enabled,
      initialDelayMs: 0,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'system1-scheduler' }),
      'system1.nightly.disabled',
    );

    enabled = true;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('treats a throwing isEnabled as disabled', async () => {
    const logger = mkLogger();
    const runOnce = vi.fn().mockResolvedValue(status());
    startSystem1Scheduler({
      logger,
      runOnce,
      isEnabled: () => {
        throw new Error('config unreadable');
      },
      initialDelayMs: 0,
      intervalMs: 100,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('does not overlap runs: the next one is scheduled after the previous finishes', async () => {
    let release: () => void = () => {};
    const runOnce = vi.fn().mockImplementation(
      () =>
        new Promise<System1Status>((resolve) => {
          release = () => resolve(status());
        }),
    );
    startSystem1Scheduler({ logger: mkLogger(), runOnce, initialDelayMs: 0, intervalMs: 50 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500); // a long training run
    expect(runOnce).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(50);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });
});
