import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';
import type { DigestSettings, DigestState } from '../core/domain';
import { DEFAULT_DIGEST_SETTINGS } from '../core/domain';

// The module falls back to Electron's real app/powerMonitor when none are injected.
vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));

import {
  createDigestRuntime,
  DIGEST_OPEN_CHANNEL,
  type DigestRuntimeOptions,
} from './digest-wiring';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

type FakeWebContents = { isLoading: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
type FakeWindow = { webContents: FakeWebContents; isDestroyed: ReturnType<typeof vi.fn> };

const makeWindow = (loading = false): FakeWindow => ({
  webContents: { isLoading: vi.fn(() => loading), send: vi.fn() },
  isDestroyed: vi.fn(() => false),
});

function setup(over: { settings?: Partial<DigestSettings>; state?: Partial<DigestState> } = {}) {
  let now = at(2026, 3, 10, 8, 0);
  const settings: DigestSettings = { ...DEFAULT_DIGEST_SETTINGS, ...over.settings };
  let state: DigestState = { lastRunDate: null, pendingEmailAccountIds: [], ...over.state };

  const useCases = {
    runDailyDigest: vi.fn(async (o: { trigger: string }) => ({ trigger: o.trigger })),
    sendPendingDigestEmails: vi.fn(async () => 0),
  };
  const digestConfig = {
    getSettings: () => settings,
    getState: () => state,
    setState: (s: DigestState) => {
      state = s;
    },
  };
  const digestOpen = { markPending: vi.fn(), consume: vi.fn(() => false) };

  const win = makeWindow(false);
  let currentWindow: FakeWindow | null = win;
  const showWindow = vi.fn(async () => {
    currentWindow ??= makeWindow(true);
    return currentWindow as unknown as BrowserWindow;
  });
  const getWindow = vi.fn(() => currentWindow as unknown as BrowserWindow | null);

  const power = new EventEmitter();
  const appHandlers: Array<() => void> = [];
  const unsubscribe = vi.fn();
  const appOn = vi.fn((_event: 'browser-window-focus', listener: () => void) => {
    appHandlers.push(listener);
    return unsubscribe;
  });

  const runtime = createDigestRuntime({
    useCases: useCases as unknown as DigestRuntimeOptions['useCases'],
    digestConfig,
    digestOpen,
    getWindow,
    showWindow,
    powerMonitor: power,
    appOn,
    now: () => now,
  });

  return {
    runtime,
    useCases,
    digestOpen,
    showWindow,
    getWindow,
    power,
    appOn,
    unsubscribe,
    focusApp: () => appHandlers.forEach((h) => h()),
    win,
    setCurrentWindow: (w: FakeWindow | null) => {
      currentWindow = w;
    },
    getState: () => state,
    setNow: (d: Date) => {
      now = d;
    },
    advance: async (ms: number) => {
      now = new Date(now.getTime() + ms);
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createDigestRuntime: scheduling', () => {
  it('start() catches up ~10 s after launch when today is past the digest time', async () => {
    const t = setup();
    t.setNow(at(2026, 3, 10, 13, 0));
    t.runtime.start();

    await vi.advanceTimersByTimeAsync(9_000);
    expect(t.useCases.runDailyDigest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledWith({ trigger: 'scheduled' });
    t.runtime.stop();
  });

  it('does not catch up before the digest time, then fires at the configured time', async () => {
    const t = setup();
    t.runtime.start();
    await t.advance(15_000);
    expect(t.useCases.runDailyDigest).not.toHaveBeenCalled();

    await t.advance(60 * 60 * 1000); // past 09:00
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1);
    expect(t.getState().lastRunDate).toBe('2026-03-10');
    t.runtime.stop();
  });

  it('does not run at all when the digest is disabled', async () => {
    const t = setup({ settings: { enabled: false } });
    t.setNow(at(2026, 3, 10, 13, 0));
    t.runtime.start();
    await t.advance(60_000);
    expect(t.useCases.runDailyDigest).not.toHaveBeenCalled();
    t.runtime.stop();
  });

  it('does not run twice on the same day across launch catch-up, ticks and wake-ups', async () => {
    const t = setup();
    t.setNow(at(2026, 3, 10, 13, 0));
    t.runtime.start();
    await t.advance(15_000);
    t.power.emit('resume');
    t.power.emit('unlock-screen');
    await t.advance(5 * 60_000);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1);
    t.runtime.stop();
  });

  it("'resume' and 'unlock-screen' check the schedule and flush deferred emails", async () => {
    const t = setup();
    t.runtime.start();
    await t.advance(15_000); // launch check (+ pending flush) is done

    t.useCases.sendPendingDigestEmails.mockClear();
    t.setNow(at(2026, 3, 10, 9, 5)); // machine slept through 09:00
    t.power.emit('resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);

    t.useCases.sendPendingDigestEmails.mockClear();
    t.power.emit('unlock-screen');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1); // already ran today
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);
    t.runtime.stop();
  });

  it('flushes deferred emails once at launch as well', async () => {
    const t = setup();
    t.runtime.start();
    await t.advance(15_000);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);
    t.runtime.stop();
  });

  it('never sends deferred emails while a digest run is still in flight', async () => {
    const t = setup();
    t.setNow(at(2026, 3, 10, 13, 0));
    let release!: () => void;
    t.useCases.runDailyDigest.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ trigger: 'scheduled' }))),
    );
    t.runtime.start();
    await vi.advanceTimersByTimeAsync(10_500); // digest started, still running

    t.power.emit('resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.sendPendingDigestEmails).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(0);
    t.runtime.stop();
  });

  it('survives sendPendingDigestEmails rejecting', async () => {
    const t = setup();
    t.useCases.sendPendingDigestEmails.mockRejectedValue(new Error('smtp'));
    t.runtime.start();
    await t.advance(15_000);
    t.power.emit('resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalled();
    t.runtime.stop();
  });

  it('stop() cancels the launch catch-up, the ticks and every listener', async () => {
    const t = setup();
    t.setNow(at(2026, 3, 10, 13, 0));
    t.runtime.start();
    t.runtime.stop();

    await t.advance(24 * 60 * 60 * 1000);
    t.power.emit('resume');
    t.focusApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.runDailyDigest).not.toHaveBeenCalled();
    expect(t.useCases.sendPendingDigestEmails).not.toHaveBeenCalled();
    expect(t.power.listenerCount('resume')).toBe(0);
    expect(t.power.listenerCount('unlock-screen')).toBe(0);
    expect(t.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start() twice does not register duplicate listeners', () => {
    const t = setup();
    t.runtime.start();
    t.runtime.start();
    expect(t.power.listenerCount('resume')).toBe(1);
    expect(t.appOn).toHaveBeenCalledTimes(1);
    t.runtime.stop();
  });

  it('can be started again after stop()', async () => {
    const t = setup();
    t.runtime.start();
    t.runtime.stop();
    t.setNow(at(2026, 3, 10, 13, 0));
    t.runtime.start();
    await t.advance(15_000);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1);
    t.runtime.stop();
  });

  it('a failing digest run is logged and does not break later wake-ups', async () => {
    const t = setup();
    t.useCases.runDailyDigest.mockRejectedValueOnce(new Error('db'));
    t.setNow(at(2026, 3, 10, 13, 0));
    t.runtime.start();
    await t.advance(15_000);
    expect(t.useCases.runDailyDigest).toHaveBeenCalledTimes(1);
    expect(() => t.power.emit('resume')).not.toThrow();
    t.runtime.stop();
  });
});

describe('createDigestRuntime: onAppFocus', () => {
  it('flushes deferred emails, throttled to once per 5 minutes', async () => {
    const t = setup();
    t.runtime.onAppFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);

    await t.advance(60_000);
    t.runtime.onAppFocus();
    await t.advance(60_000);
    t.runtime.onAppFocus();
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);

    await t.advance(3 * 60_000 + 1_000); // just past 5 min since the first call
    t.runtime.onAppFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(2);
  });

  it('start() hooks the app focus event to onAppFocus', async () => {
    const t = setup();
    t.runtime.start();
    await t.advance(15_000);
    t.useCases.sendPendingDigestEmails.mockClear();

    t.focusApp();
    t.focusApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);
    t.runtime.stop();
  });

  it('does not overlap two flushes', async () => {
    const t = setup();
    let release!: () => void;
    t.useCases.sendPendingDigestEmails.mockImplementation(
      () => new Promise<number>((resolve) => (release = () => resolve(0))),
    );
    t.runtime.onAppFocus();
    await t.advance(6 * 60_000); // throttle window passed, first flush still pending
    t.runtime.onAppFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.useCases.sendPendingDigestEmails).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('never throws when the flush rejects', async () => {
    const t = setup();
    t.useCases.sendPendingDigestEmails.mockRejectedValue(new Error('smtp'));
    expect(() => t.runtime.onAppFocus()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe('createDigestRuntime: openNeedsReply', () => {
  it('marks the open request pending, shows the window, and pushes digest:open when loaded', async () => {
    const t = setup();
    await t.runtime.openNeedsReply();

    expect(t.digestOpen.markPending).toHaveBeenCalledTimes(1);
    expect(t.showWindow).toHaveBeenCalledTimes(1);
    expect(t.win.webContents.send).toHaveBeenCalledWith(DIGEST_OPEN_CHANNEL);
    expect(DIGEST_OPEN_CHANNEL).toBe('digest:open');
  });

  it('marks pending before it shows the window (so a fast renderer mount can pull it)', async () => {
    const t = setup();
    const order: string[] = [];
    t.digestOpen.markPending.mockImplementation(() => order.push('mark'));
    t.showWindow.mockImplementation(async () => {
      order.push('show');
      return t.win as unknown as BrowserWindow;
    });
    await t.runtime.openNeedsReply();
    expect(order).toEqual(['mark', 'show']);
  });

  it('does not push the event while the window is still loading (the renderer pulls consumePendingOpen on mount)', async () => {
    const t = setup();
    const loading = makeWindow(true);
    t.setCurrentWindow(loading);
    await t.runtime.openNeedsReply();

    expect(t.digestOpen.markPending).toHaveBeenCalledTimes(1);
    expect(t.showWindow).toHaveBeenCalledTimes(1);
    expect(loading.webContents.send).not.toHaveBeenCalled();
  });

  it('creates the window when none exists (all windows closed on macOS)', async () => {
    const t = setup();
    t.setCurrentWindow(null);
    await t.runtime.openNeedsReply();
    expect(t.showWindow).toHaveBeenCalledTimes(1);
    expect(t.digestOpen.markPending).toHaveBeenCalledTimes(1);
  });

  it('does not send to a destroyed window', async () => {
    const t = setup();
    t.win.isDestroyed.mockReturnValue(true);
    await expect(t.runtime.openNeedsReply()).resolves.toBeUndefined();
    expect(t.win.webContents.send).not.toHaveBeenCalled();
  });

  it('keeps the request pending and does not throw when the window cannot be shown', async () => {
    const t = setup();
    t.showWindow.mockRejectedValueOnce(new Error('no display'));
    await expect(t.runtime.openNeedsReply()).resolves.toBeUndefined();
    expect(t.digestOpen.markPending).toHaveBeenCalledTimes(1);
    expect(t.win.webContents.send).not.toHaveBeenCalled();
  });
});
