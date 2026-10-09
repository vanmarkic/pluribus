/**
 * Digest runtime wiring (Electron main process).
 *
 * Connects the daily "Needs your reply" digest to the app lifecycle:
 * - a scheduler that runs the digest once per local day at the configured time;
 * - catch-up ~10 s after launch and on wake / screen unlock, so a digest that
 *   was missed while the app was closed or the machine asleep still runs;
 * - flushing digest emails that were deferred while credentials were locked
 *   (on unlock, wake, and app focus, throttled);
 * - opening the Needs-your-reply view when the notification is clicked.
 *
 * Everything Electron-specific (power monitor, app events, windows) is
 * injectable so the runtime is unit-testable under vitest.
 */

import { app, powerMonitor as electronPowerMonitor } from 'electron';
import type { BrowserWindow } from 'electron';
import type { DigestTrigger } from '../core/domain';
import type { DigestConfigStore } from '../core/ports';
import type { UseCases } from '../core';
import { startDigestScheduler, type DigestScheduler } from './schedulers/digest-scheduler';

/** Push event telling the renderer to show the Needs-your-reply view. */
export const DIGEST_OPEN_CHANNEL = 'digest:open';

const STARTUP_CATCH_UP_DELAY_MS = 10_000;
const FOCUS_FLUSH_THROTTLE_MS = 5 * 60 * 1000;

/** The slice of Electron's powerMonitor (an EventEmitter) that is used. */
export type PowerMonitorLike = {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
};

/** Subscribes to an app-level event and returns the unsubscribe function. */
export type AppEventSubscriber = (
  event: 'browser-window-focus',
  listener: () => void,
) => () => void;

export type DigestRuntimeOptions = {
  useCases: Pick<UseCases, 'runDailyDigest' | 'sendPendingDigestEmails'>;
  digestConfig: DigestConfigStore;
  digestOpen: { markPending(): void; consume(): boolean };
  getWindow: () => BrowserWindow | null;
  /** Show and focus the main window, creating it if it does not exist. */
  showWindow: () => Promise<BrowserWindow>;
  /** Defaults to Electron's powerMonitor. */
  powerMonitor?: PowerMonitorLike;
  /** Defaults to subscribing on Electron's `app`. */
  appOn?: AppEventSubscriber;
  /** Injectable clock and timers (tests). */
  now?: () => Date;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

export type DigestRuntime = {
  start(): void;
  stop(): void;
  /** Notification click: bring the app to the Needs-your-reply view. */
  openNeedsReply(): Promise<void>;
  /** Call when the app gains focus; flushes deferred digest emails (throttled). */
  onAppFocus(): void;
};

const defaultAppOn: AppEventSubscriber = (event, listener) => {
  app.on(event, listener);
  return () => {
    app.removeListener(event, listener);
  };
};

const liveWindow = (win: BrowserWindow | null | undefined): BrowserWindow | null =>
  win && !win.isDestroyed() ? win : null;

export function createDigestRuntime(opts: DigestRuntimeOptions): DigestRuntime {
  const { useCases, digestConfig, digestOpen, getWindow, showWindow } = opts;
  const nowFn = opts.now ?? (() => new Date());
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;

  let scheduler: DigestScheduler | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let disposers: Array<() => void> = [];
  let started = false;
  let stopped = false;

  let digestInFlight = false;
  let flushInFlight = false;
  let lastFocusFlushAt: number | null = null;

  async function runDigest(trigger: DigestTrigger): Promise<unknown> {
    digestInFlight = true;
    try {
      return await useCases.runDailyDigest({ trigger });
    } finally {
      digestInFlight = false;
    }
  }

  /** Send deferred digest emails. Never overlaps itself or a running digest (no duplicate mails). */
  async function flushPending(): Promise<void> {
    if (stopped || flushInFlight || digestInFlight) return;
    flushInFlight = true;
    try {
      await useCases.sendPendingDigestEmails();
    } catch (err) {
      console.warn('[digest] Sending deferred digest emails failed:', err);
    } finally {
      flushInFlight = false;
    }
  }

  /** Run the digest if it is due (catch-up), then flush deferred emails. */
  async function catchUp(): Promise<void> {
    await scheduler?.checkNow();
    await flushPending();
  }

  function onWake(): void {
    void catchUp();
  }

  function onAppFocus(): void {
    if (stopped) return;
    const now = nowFn().getTime();
    if (lastFocusFlushAt !== null && now - lastFocusFlushAt < FOCUS_FLUSH_THROTTLE_MS) return;
    lastFocusFlushAt = now;
    void flushPending();
  }

  async function openNeedsReply(): Promise<void> {
    // Pending first: if the window is created or still loading, the renderer
    // pulls the request via digest:consumePendingOpen when it mounts.
    digestOpen.markPending();

    let shown: BrowserWindow;
    try {
      shown = await showWindow();
    } catch (err) {
      console.error('[digest] Could not show the window:', err);
      return;
    }

    const win = liveWindow(getWindow()) ?? liveWindow(shown);
    if (win && !win.webContents.isLoading()) {
      win.webContents.send(DIGEST_OPEN_CHANNEL);
    }
  }

  function start(): void {
    if (started) return;
    started = true;
    stopped = false;

    scheduler = startDigestScheduler({
      getSettings: () => digestConfig.getSettings(),
      getState: () => digestConfig.getState(),
      setState: (state) => digestConfig.setState(state),
      run: runDigest,
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.setTimeoutFn ? { setTimeoutFn: opts.setTimeoutFn } : {}),
      ...(opts.clearTimeoutFn ? { clearTimeoutFn: opts.clearTimeoutFn } : {}),
    });

    // Catch up shortly after launch, once startup has settled.
    startupTimer = setTimeoutFn(() => {
      startupTimer = null;
      void catchUp();
    }, STARTUP_CATCH_UP_DELAY_MS);
    if (typeof startupTimer === 'object' && startupTimer !== null && 'unref' in startupTimer) {
      (startupTimer as { unref: () => void }).unref();
    }

    // Wake / unlock: timers pause while the machine sleeps, so re-check explicitly.
    const monitor = opts.powerMonitor ?? electronPowerMonitor;
    monitor.on('resume', onWake);
    monitor.on('unlock-screen', onWake);
    disposers.push(
      () => monitor.removeListener('resume', onWake),
      () => monitor.removeListener('unlock-screen', onWake),
    );

    disposers.push((opts.appOn ?? defaultAppOn)('browser-window-focus', onAppFocus));
  }

  function stop(): void {
    stopped = true;
    started = false;
    scheduler?.stop();
    scheduler = null;
    if (startupTimer !== null) {
      clearTimeoutFn(startupTimer);
      startupTimer = null;
    }
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (err) {
        console.warn('[digest] Failed to remove a listener:', err);
      }
    }
    disposers = [];
  }

  return { start, stop, openNeedsReply, onAppFocus };
}
