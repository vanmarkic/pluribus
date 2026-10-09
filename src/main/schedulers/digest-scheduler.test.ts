import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { DigestSettings, DigestState } from '../../core/domain';
import { DEFAULT_DIGEST_SETTINGS } from '../../core/domain';
import {
  isDue,
  localDateKey,
  startDigestScheduler,
  type DigestSchedulerOptions,
} from './digest-scheduler';

// Wall-clock arithmetic is the whole point of these tests, so pin a zone that
// has DST. Constructing Dates with the local-time constructor keeps every case
// zone-independent, but the DST cases are only meaningful in a DST zone.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Brussels';
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Local wall-clock Date (month is 1-based for readability). */
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s);

describe('localDateKey', () => {
  it('formats the local calendar date as YYYY-MM-DD, zero padded', () => {
    expect(localDateKey(at(2026, 3, 5, 9, 0))).toBe('2026-03-05');
    expect(localDateKey(at(2026, 12, 31, 23, 59, 59))).toBe('2026-12-31');
  });

  it('uses local time, not UTC (00:30 local is still the same local day)', () => {
    expect(localDateKey(at(2026, 6, 1, 0, 30))).toBe('2026-06-01');
    expect(localDateKey(at(2026, 6, 1, 23, 59))).toBe('2026-06-01');
  });
});

describe('isDue', () => {
  it('is false before the configured time', () => {
    expect(isDue(at(2026, 3, 10, 8, 59, 59), null, '09:00')).toBe(false);
    expect(isDue(at(2026, 3, 10, 8, 59), '2026-03-09', '09:00')).toBe(false);
  });

  it('is true at the configured time when it has not run today', () => {
    expect(isDue(at(2026, 3, 10, 9, 0), null, '09:00')).toBe(true);
    expect(isDue(at(2026, 3, 10, 9, 0, 30), '2026-03-09', '09:00')).toBe(true);
  });

  it('is true any time after the configured time (catch-up)', () => {
    expect(isDue(at(2026, 3, 10, 14, 30), null, '09:00')).toBe(true);
    expect(isDue(at(2026, 3, 10, 23, 59), '2026-03-09', '09:00')).toBe(true);
  });

  it('is false once it has run today', () => {
    expect(isDue(at(2026, 3, 10, 9, 0), '2026-03-10', '09:00')).toBe(false);
    expect(isDue(at(2026, 3, 10, 18, 0), '2026-03-10', '09:00')).toBe(false);
  });

  it('is true the next day after the time when it last ran yesterday', () => {
    expect(isDue(at(2026, 3, 11, 9, 1), '2026-03-10', '09:00')).toBe(true);
    expect(isDue(at(2026, 3, 11, 8, 0), '2026-03-10', '09:00')).toBe(false);
  });

  it('is true after several missed days', () => {
    expect(isDue(at(2026, 3, 20, 10, 0), '2026-03-10', '09:00')).toBe(true);
  });

  it('is not suppressed by a lastRunDate in the future (clock was corrected)', () => {
    expect(isDue(at(2026, 3, 10, 10, 0), '2026-03-15', '09:00')).toBe(true);
  });

  it('handles midnight and end-of-day times', () => {
    expect(isDue(at(2026, 3, 10, 0, 0), '2026-03-09', '00:00')).toBe(true);
    expect(isDue(at(2026, 3, 10, 23, 58), '2026-03-09', '23:59')).toBe(false);
    expect(isDue(at(2026, 3, 10, 23, 59), '2026-03-09', '23:59')).toBe(true);
  });

  it.each([
    '',
    '9:00',
    '09:0',
    '24:00',
    '09:60',
    '0900',
    '09-00',
    'ab:cd',
    '09:00:00',
    ' 09:00',
    '-1:00',
  ])('is false for invalid time %j', (hhmm) => {
    expect(isDue(at(2026, 3, 10, 12, 0), null, hhmm)).toBe(false);
  });

  it('is false for an invalid Date', () => {
    expect(isDue(new Date('nope'), null, '09:00')).toBe(false);
  });

  describe('DST transitions (Europe/Brussels)', () => {
    it('the zone under test really has DST', () => {
      // 2026-03-29 02:00 -> 03:00 (spring forward)
      const before = at(2026, 3, 29, 1, 59).getTime();
      const after = at(2026, 3, 29, 3, 0).getTime();
      expect(after - before).toBe(60 * 1000);
    });

    it('spring forward: a time inside the skipped hour fires as soon as the clock jumps past it', () => {
      // 02:30 does not exist on 2026-03-29; at 03:00 local the digest is due.
      expect(isDue(at(2026, 3, 29, 1, 59), '2026-03-28', '02:30')).toBe(false);
      expect(isDue(at(2026, 3, 29, 3, 0), '2026-03-28', '02:30')).toBe(true);
    });

    it('spring forward: a 09:00 digest is neither skipped nor doubled', () => {
      expect(isDue(at(2026, 3, 29, 8, 59), '2026-03-28', '09:00')).toBe(false);
      expect(isDue(at(2026, 3, 29, 9, 0), '2026-03-28', '09:00')).toBe(true);
      expect(isDue(at(2026, 3, 29, 9, 1), '2026-03-29', '09:00')).toBe(false);
    });

    it('fall back: the repeated hour cannot fire twice (lastRunDate gates it)', () => {
      // 2026-10-25 03:00 -> 02:00; 02:30 happens twice.
      const first = new Date(at(2026, 10, 25, 0, 0).getTime() + 2.5 * 3600 * 1000); // 02:30 CEST
      const second = new Date(first.getTime() + 3600 * 1000); // 02:30 CET
      expect(localDateKey(first)).toBe('2026-10-25');
      expect(localDateKey(second)).toBe('2026-10-25');
      expect(isDue(first, '2026-10-24', '02:30')).toBe(true);
      expect(isDue(second, '2026-10-25', '02:30')).toBe(false);
    });

    it('fall back: a 09:00 digest fires once on the 25-hour day', () => {
      expect(isDue(at(2026, 10, 25, 8, 59), '2026-10-24', '09:00')).toBe(false);
      expect(isDue(at(2026, 10, 25, 9, 0), '2026-10-24', '09:00')).toBe(true);
      expect(isDue(at(2026, 10, 25, 9, 0), '2026-10-25', '09:00')).toBe(false);
    });

    it('the day after a transition is a normal day', () => {
      expect(isDue(at(2026, 3, 30, 9, 0), '2026-03-29', '09:00')).toBe(true);
      expect(isDue(at(2026, 10, 26, 9, 0), '2026-10-25', '09:00')).toBe(true);
    });
  });
});

describe('startDigestScheduler', () => {
  let settings: DigestSettings;
  let state: DigestState;
  let nowDate: Date;
  let run: ReturnType<typeof vi.fn>;
  const warn = vi.fn();

  const start = (over: Record<string, unknown> = {}) =>
    startDigestScheduler({
      getSettings: () => settings,
      getState: () => state,
      setState: (s) => {
        state = s;
      },
      run: run as unknown as DigestSchedulerOptions['run'],
      now: () => nowDate,
      logger: { warn },
      ...over,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    settings = { ...DEFAULT_DIGEST_SETTINGS };
    state = { lastRunDate: null, pendingEmailAccountIds: [] };
    nowDate = at(2026, 3, 10, 8, 0);
    run = vi.fn(async () => ({}));
    warn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance the fake wall clock and the fake timers together. */
  const advance = async (ms: number) => {
    nowDate = new Date(nowDate.getTime() + ms);
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('fires once when the configured time is reached, with the scheduled trigger', async () => {
    const s = start();
    await advance(30 * 60 * 1000); // 08:30
    expect(run).not.toHaveBeenCalled();

    await advance(30 * 60 * 1000); // 09:00
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('scheduled');

    await advance(3 * 60 * 60 * 1000); // later the same day
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('records lastRunDate as the local date key and fires again the next day', async () => {
    const s = start();
    await advance(60 * 60 * 1000); // 09:00
    expect(state.lastRunDate).toBe('2026-03-10');

    await advance(24 * 60 * 60 * 1000); // next day 09:00
    expect(run).toHaveBeenCalledTimes(2);
    expect(state.lastRunDate).toBe('2026-03-11');
    s.stop();
  });

  it('keeps the other state fields when it records lastRunDate', async () => {
    state = { lastRunDate: null, pendingEmailAccountIds: [3, 4] };
    const s = start();
    await advance(60 * 60 * 1000);
    expect(state).toEqual({ lastRunDate: '2026-03-10', pendingEmailAccountIds: [3, 4] });
    s.stop();
  });

  it('checkNow() catches up immediately when already past the time', async () => {
    nowDate = at(2026, 3, 10, 13, 0);
    const s = start();
    expect(run).not.toHaveBeenCalled();
    await s.checkNow();
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('marks the day as run BEFORE awaiting the run', async () => {
    nowDate = at(2026, 3, 10, 13, 0);
    let stateDuringRun: string | null | undefined;
    run.mockImplementation(async () => {
      stateDuringRun = state.lastRunDate;
    });
    const s = start();
    await s.checkNow();
    expect(stateDuringRun).toBe('2026-03-10');
    s.stop();
  });

  it('does not double-fire with concurrent checkNow() calls', async () => {
    nowDate = at(2026, 3, 10, 13, 0);
    let release!: () => void;
    run.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const s = start();

    const a = s.checkNow();
    const b = s.checkNow();
    const c = s.checkNow();
    release();
    await Promise.all([a, b, c]);
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('a timer tick is a no-op while a run is still in flight', async () => {
    nowDate = at(2026, 3, 10, 9, 0);
    let release!: () => void;
    run.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const s = start({ tickMs: 1000 });

    const first = s.checkNow();
    await advance(5000); // several ticks while the run hangs
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    s.stop();
  });

  it('survives run() rejecting: logs, keeps scheduling, and does not retry the same day', async () => {
    run.mockRejectedValueOnce(new Error('boom'));
    const s = start();
    await advance(60 * 60 * 1000); // 09:00 -> rejects
    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    await advance(60 * 60 * 1000); // still scheduling, but not due again today
    expect(run).toHaveBeenCalledTimes(1);

    await advance(23 * 60 * 60 * 1000); // next day 09:00
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('survives run() throwing synchronously', async () => {
    run.mockImplementationOnce(() => {
      throw new Error('sync boom');
    });
    nowDate = at(2026, 3, 10, 13, 0);
    const s = start();
    await expect(s.checkNow()).resolves.toBeUndefined();
    // and a later check is not wedged "in flight"
    state = { ...state, lastRunDate: null };
    await s.checkNow();
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('survives getSettings()/getState() throwing', async () => {
    nowDate = at(2026, 3, 10, 13, 0);
    const s = start({
      getSettings: () => {
        throw new Error('store unavailable');
      },
    });
    await expect(s.checkNow()).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    s.stop();
  });

  it('never runs while the digest is disabled, and picks up the setting live', async () => {
    settings = { ...settings, enabled: false };
    const s = start();
    await advance(60 * 60 * 1000); // 09:00
    await s.checkNow();
    expect(run).not.toHaveBeenCalled();
    expect(state.lastRunDate).toBeNull();

    settings = { ...settings, enabled: true };
    await advance(60 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('reads the time setting on every tick', async () => {
    settings = { ...settings, time: '10:30' };
    const s = start();
    await advance(2 * 60 * 60 * 1000); // 10:00
    expect(run).not.toHaveBeenCalled();
    await advance(30 * 60 * 1000); // 10:30
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('does not run for an invalid configured time', async () => {
    settings = { ...settings, time: '25:99' };
    const s = start();
    await advance(24 * 60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
    s.stop();
  });

  it('ticks every 60 s by default', async () => {
    nowDate = at(2026, 3, 10, 9, 0);
    state = { lastRunDate: '2026-03-10', pendingEmailAccountIds: [] };
    const getSettings = vi.fn(() => settings);
    const s = start({ getSettings });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(getSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getSettings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSettings).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('stop() clears the pending timer and prevents any further runs', async () => {
    const s = start();
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);

    await advance(48 * 60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
    await s.checkNow();
    expect(run).not.toHaveBeenCalled();
  });

  it('stop() during an in-flight run does not re-arm the timer', async () => {
    nowDate = at(2026, 3, 10, 9, 0);
    let release!: () => void;
    run.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const s = start({ tickMs: 1000 });
    const pending = s.checkNow();
    s.stop();
    release();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unrefs its timers so they never keep the process alive', () => {
    const unref = vi.fn();
    const setTimeoutFn = vi.fn(() => ({ unref }) as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutFn = vi.fn();
    const s = start({ setTimeoutFn, clearTimeoutFn });
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    s.stop();
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it('works with injected timer functions (no globals needed)', async () => {
    const callbacks: Array<() => void> = [];
    const setTimeoutFn = vi.fn((cb: () => void) => {
      callbacks.push(cb);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    });
    nowDate = at(2026, 3, 10, 9, 0);
    const s = start({
      setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: vi.fn(),
    });

    callbacks[0]!(); // first tick
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(callbacks.length).toBe(2); // re-armed after the tick
    s.stop();
  });
});
