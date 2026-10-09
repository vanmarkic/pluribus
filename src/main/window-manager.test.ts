import { describe, it, expect, vi, type Mock } from 'vitest';
import { createWindowManager, sendToRenderer, type BrowserWindowLike } from './window-manager';

type FakeWindow = BrowserWindowLike & {
  destroy(): void;
  close(): void;
  minimize(): void;
  restore: Mock<() => void>;
  show: Mock<() => void>;
  focus: Mock<() => void>;
  webContents: {
    send: Mock<(channel: string, ...args: any[]) => void>;
    isLoading: Mock<() => boolean>;
  };
};

/** A fake BrowserWindow with just enough behaviour for the manager. */
function makeWindow(): FakeWindow {
  let destroyed = false;
  let minimized = false;
  const closedListeners: Array<() => void> = [];

  const win: FakeWindow = {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: vi.fn<() => void>(() => {
      minimized = false;
    }),
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
    on: (event: 'closed', listener: () => void) => {
      if (event === 'closed') closedListeners.push(listener);
      return win;
    },
    webContents: {
      send: vi.fn<(channel: string, ...args: any[]) => void>(),
      isLoading: vi.fn<() => boolean>(() => false),
    },
    minimize: () => {
      minimized = true;
    },
    // Electron marks the window destroyed before it emits 'closed'.
    close: () => {
      destroyed = true;
      for (const l of closedListeners) l();
    },
    // Destroyed without a 'closed' event having reached the manager (yet).
    destroy: () => {
      destroyed = true;
    },
  };
  return win;
}

function setup() {
  const windows: FakeWindow[] = [];
  const createBrowserWindow = vi.fn(async () => {
    const win = makeWindow();
    windows.push(win);
    return win;
  });
  const manager = createWindowManager({ createBrowserWindow });
  return { manager, createBrowserWindow, windows };
}

describe('createWindowManager', () => {
  it('has no window until showWindow is called', () => {
    const { manager, createBrowserWindow } = setup();
    expect(manager.getWindow()).toBeNull();
    expect(createBrowserWindow).not.toHaveBeenCalled();
  });

  it('creates the window on the first showWindow call and returns it from getWindow', async () => {
    const { manager, createBrowserWindow, windows } = setup();
    const win = await manager.showWindow();
    expect(createBrowserWindow).toHaveBeenCalledTimes(1);
    expect(win).toBe(windows[0]);
    expect(manager.getWindow()).toBe(win);
  });

  it('reuses the live window instead of creating another', async () => {
    const { manager, createBrowserWindow } = setup();
    const first = await manager.showWindow();
    const second = await manager.showWindow();
    expect(second).toBe(first);
    expect(createBrowserWindow).toHaveBeenCalledTimes(1);
  });

  it('shows and focuses an existing window', async () => {
    const { manager, windows } = setup();
    await manager.showWindow();
    const win = windows[0]!;
    win.show.mockClear();
    win.focus.mockClear();

    await manager.showWindow();
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.restore).not.toHaveBeenCalled();
  });

  it('restores a minimized window before showing it', async () => {
    const { manager, windows } = setup();
    await manager.showWindow();
    const win = windows[0]!;
    win.minimize();

    await manager.showWindow();
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.restore.mock.invocationCallOrder[0]!).toBeLessThan(
      win.show.mock.invocationCallOrder.at(-1)!,
    );
    expect(win.focus).toHaveBeenCalled();
  });

  it('creates only one window for concurrent calls', async () => {
    const { manager, createBrowserWindow } = setup();
    const [a, b, c] = await Promise.all([
      manager.showWindow(),
      manager.showWindow(),
      manager.showWindow(),
    ]);
    expect(createBrowserWindow).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(manager.getWindow()).toBe(a);
  });

  it('does not expose a window that is still being created', async () => {
    let resolve!: (w: FakeWindow) => void;
    const createBrowserWindow = vi.fn(
      () =>
        new Promise<FakeWindow>((r) => {
          resolve = r;
        }),
    );
    const manager = createWindowManager({ createBrowserWindow });

    const pending = manager.showWindow();
    expect(manager.getWindow()).toBeNull();

    const win = makeWindow();
    resolve(win);
    await expect(pending).resolves.toBe(win);
    expect(manager.getWindow()).toBe(win);
  });

  it('clears the window when it is closed and creates a new one next time', async () => {
    const { manager, createBrowserWindow, windows } = setup();
    const first = await manager.showWindow();
    windows[0]!.close();
    expect(manager.getWindow()).toBeNull();

    const second = await manager.showWindow();
    expect(createBrowserWindow).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(manager.getWindow()).toBe(second);
  });

  it('treats a destroyed window as gone even before the closed event arrives', async () => {
    const { manager, createBrowserWindow, windows } = setup();
    await manager.showWindow();
    windows[0]!.destroy();
    expect(manager.getWindow()).toBeNull();

    await manager.showWindow();
    expect(createBrowserWindow).toHaveBeenCalledTimes(2);
  });

  it('a late closed event from an old window does not clear the new one', async () => {
    const { manager, windows } = setup();
    await manager.showWindow();
    const old = windows[0]!;
    old.destroy();

    const fresh = await manager.showWindow();
    old.close(); // emits 'closed' for the old window only
    expect(manager.getWindow()).toBe(fresh);
  });

  it('recovers after a failed creation: the error propagates and the next call retries', async () => {
    const windows: FakeWindow[] = [];
    const createBrowserWindow = vi
      .fn<() => Promise<FakeWindow>>()
      .mockRejectedValueOnce(new Error('load failed'))
      .mockImplementation(async () => {
        const w = makeWindow();
        windows.push(w);
        return w;
      });
    const manager = createWindowManager({ createBrowserWindow });

    await expect(manager.showWindow()).rejects.toThrow('load failed');
    expect(manager.getWindow()).toBeNull();

    const win = await manager.showWindow();
    expect(win).toBe(windows[0]);
    expect(createBrowserWindow).toHaveBeenCalledTimes(2);
  });

  it('does not touch a window that was destroyed while it was being created', async () => {
    const win = makeWindow();
    win.destroy();
    const manager = createWindowManager({ createBrowserWindow: async () => win });

    await expect(manager.showWindow()).resolves.toBe(win);
    expect(win.show).not.toHaveBeenCalled();
    expect(manager.getWindow()).toBeNull();
  });
});

describe('sendToRenderer', () => {
  it('sends to the live window and reports delivery', () => {
    const win = makeWindow();
    const delivered = sendToRenderer(() => win, 'sync:progress', { done: 1 });
    expect(delivered).toBe(true);
    expect(win.webContents.send).toHaveBeenCalledWith('sync:progress', { done: 1 });
  });

  it('sends a bare channel when there is no payload', () => {
    const win = makeWindow();
    sendToRenderer(() => win, 'digest:open');
    expect(win.webContents.send).toHaveBeenCalledWith('digest:open');
    expect(win.webContents.send.mock.calls[0]).toHaveLength(1);
  });

  it('is a no-op when there is no window', () => {
    expect(sendToRenderer(() => null, 'x', 1)).toBe(false);
  });

  it('is a no-op when the window is destroyed', () => {
    const win = makeWindow();
    win.destroy();
    expect(sendToRenderer(() => win, 'x', 1)).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('asks for the window on every call, so a re-created window receives events', async () => {
    const { manager, windows } = setup();
    await manager.showWindow();
    windows[0]!.close();
    await manager.showWindow();

    expect(sendToRenderer(() => manager.getWindow(), 'ping', 1)).toBe(true);
    expect(windows[0]!.webContents.send).not.toHaveBeenCalled();
    expect(windows[1]!.webContents.send).toHaveBeenCalledWith('ping', 1);
  });

  it('swallows a send failure (window torn down between the check and the send)', () => {
    const win = makeWindow();
    win.webContents.send.mockImplementation(() => {
      throw new Error('Object has been destroyed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(sendToRenderer(() => win, 'x', 1)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
