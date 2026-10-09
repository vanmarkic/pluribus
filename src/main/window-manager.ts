/**
 * Window manager
 *
 * Owns the single main window and hands out a stable way to reach it:
 * - `getWindow()` returns the live window or null (never a destroyed one);
 * - `showWindow()` creates the window if there is none, otherwise
 *   restores / shows / focuses the existing one. Concurrent calls share one
 *   creation, so a notification click and a dock click racing each other
 *   still open exactly one window.
 *
 * The app keeps running (macOS) after its window is closed so the daily digest
 * can still fire, which means the window is no longer a startup constant:
 * everything that talks to the renderer takes a getter and asks for the
 * current window each time (see `sendToRenderer`).
 *
 * This file imports nothing from Electron. The window factory is injected and
 * the window is described structurally, so the logic is unit-testable under
 * vitest; `index.ts` supplies the real `BrowserWindow`.
 */

/** The part of a window that events are pushed through. */
export type RendererWindow = {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: any[]): void };
};

/** Late-bound access to the current window (null when none is open). */
export type WindowGetter = () => RendererWindow | null;

/** The minimal slice of Electron's BrowserWindow the manager relies on. */
export type BrowserWindowLike = RendererWindow & {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  on(event: 'closed', listener: () => void): unknown;
  webContents: { send(channel: string, ...args: any[]): void; isLoading(): boolean };
};

export type WindowManagerOptions<W extends BrowserWindowLike> = {
  /** Builds and loads a new window. Only called when there is no live window. */
  createBrowserWindow: () => Promise<W>;
};

export type WindowManager<W extends BrowserWindowLike> = {
  /** The live window, or null when none is open (or it has been destroyed). */
  getWindow(): W | null;
  /**
   * Show the main window, creating it first when needed. Resolves with the window.
   * If the window is closed while it is still being created, it resolves with
   * that (destroyed) window and nothing is stored; callers re-check `getWindow()`.
   */
  showWindow(): Promise<W>;
};

export function createWindowManager<W extends BrowserWindowLike>(
  opts: WindowManagerOptions<W>,
): WindowManager<W> {
  let current: W | null = null;
  let pending: Promise<W> | null = null;

  const getWindow = (): W | null => {
    if (current && current.isDestroyed()) current = null;
    return current;
  };

  const reveal = (win: W): void => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  async function create(): Promise<W> {
    const win = await opts.createBrowserWindow();
    // Closed before it finished loading: there is nothing to show or track.
    if (win.isDestroyed()) return win;

    current = win;
    win.on('closed', () => {
      // A stale event from an earlier window must not clear a newer one.
      if (current === win) current = null;
    });
    reveal(win);
    return win;
  }

  async function showWindow(): Promise<W> {
    const existing = getWindow();
    if (existing) {
      reveal(existing);
      return existing;
    }

    if (!pending) {
      pending = create().finally(() => {
        pending = null;
      });
    }
    return pending;
  }

  return { getWindow, showWindow };
}

/**
 * Push an event to the renderer through the current window. Does nothing when
 * there is no window (closed on macOS, not yet created) or it is being torn
 * down. Returns whether the event was handed to a window.
 */
export function sendToRenderer(
  getWindow: WindowGetter,
  channel: string,
  payload?: unknown,
): boolean {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;
  try {
    if (payload === undefined) win.webContents.send(channel);
    else win.webContents.send(channel, payload);
    return true;
  } catch (err) {
    // The window can be destroyed between the check above and the send.
    console.warn(`[ipc] Could not send '${channel}' to the renderer:`, err);
    return false;
  }
}
