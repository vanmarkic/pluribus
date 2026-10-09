/**
 * Handlers that push events to the renderer (sync progress, classification
 * status, streaming deltas) ask a window getter for the window on every send.
 * With the window closed (macOS keeps the app alive for the daily digest) they
 * must neither throw nor leak events to a stale window, and a re-created
 * window must receive events again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container } from '../container';

const { handlers, classifyStreaming } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  classifyStreaming: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));
vi.mock('../../adapters/llm', () => ({ classifyStreaming }));

import { setupSyncHandlers } from './sync-handlers';
import { setupClassificationHandlers } from './classification-handlers';
import { setupStreamingHandlers } from './streaming-handlers';
import type { WindowGetter } from '../window-manager';

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return Promise.resolve().then(() => fn({}, ...args));
};

function makeWindow() {
  let destroyed = false;
  return {
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    },
    webContents: { send: vi.fn() },
  };
}
type FakeWindow = ReturnType<typeof makeWindow>;

/** A getter whose current window can be swapped, like the real window manager's. */
function makeGetter(initial: FakeWindow | null) {
  let current = initial;
  const getWindow: WindowGetter = () => current;
  return {
    getWindow,
    set: (w: FakeWindow | null) => {
      current = w;
    },
  };
}

beforeEach(() => {
  handlers.clear();
  classifyStreaming.mockReset();
});

describe('sync handlers', () => {
  function setup(getWindow: WindowGetter) {
    let onProgress: (p: unknown) => void = () => {};
    const container = {
      useCases: {},
      deps: {
        sync: {
          onProgress: vi.fn((cb: (p: unknown) => void) => {
            onProgress = cb;
          }),
        },
      },
    } as unknown as Container;
    setupSyncHandlers(container, getWindow);
    return { emit: (p: unknown) => onProgress(p) };
  }

  it('forwards progress to the current window', () => {
    const win = makeWindow();
    const { emit } = setup(makeGetter(win).getWindow);
    emit({ phase: 'headers', done: 1 });
    expect(win.webContents.send).toHaveBeenCalledWith('sync:progress', {
      phase: 'headers',
      done: 1,
    });
  });

  it('drops progress while no window is open, and resumes with a re-created window', () => {
    const first = makeWindow();
    const g = makeGetter(first);
    const { emit } = setup(g.getWindow);

    first.destroy();
    g.set(null);
    expect(() => emit({ n: 1 })).not.toThrow();
    expect(first.webContents.send).not.toHaveBeenCalled();

    const second = makeWindow();
    g.set(second);
    emit({ n: 2 });
    expect(second.webContents.send).toHaveBeenCalledWith('sync:progress', { n: 2 });
    expect(first.webContents.send).not.toHaveBeenCalled();
  });

  it('does not resolve the window when handlers are registered', () => {
    const getWindow = vi.fn(() => null);
    setup(getWindow);
    expect(getWindow).not.toHaveBeenCalled();
  });
});

describe('classification handlers', () => {
  function setup(getWindow: WindowGetter, classifyEmail: () => Promise<unknown>) {
    const container = {
      useCases: { classifyEmail },
      deps: {},
      config: { get: vi.fn() },
    } as unknown as Container;
    setupClassificationHandlers(container, getWindow);
  }

  it('announces classification start and result to the current window', async () => {
    const win = makeWindow();
    setup(makeGetter(win).getWindow, async () => ({ folder: 'Feed' }));

    await expect(invoke('llm:classify', 7)).resolves.toEqual({ folder: 'Feed' });
    expect(win.webContents.send).toHaveBeenNthCalledWith(1, 'llm:classifying', { emailId: 7 });
    expect(win.webContents.send).toHaveBeenNthCalledWith(2, 'llm:classified', {
      emailId: 7,
      result: { folder: 'Feed' },
    });
  });

  it('still returns the result when there is no window', async () => {
    setup(makeGetter(null).getWindow, async () => ({ folder: 'Inbox' }));
    await expect(invoke('llm:classify', 8)).resolves.toEqual({ folder: 'Inbox' });
  });

  it('reports a failure to the window and rethrows the original error', async () => {
    const win = makeWindow();
    setup(makeGetter(win).getWindow, async () => {
      throw new Error('boom');
    });

    await expect(invoke('llm:classify', 9)).rejects.toThrow('boom');
    expect(win.webContents.send).toHaveBeenCalledWith('llm:error', {
      emailId: 9,
      error: 'Error: boom',
    });
  });

  it('rethrows the original error even with no window to tell', async () => {
    setup(makeGetter(null).getWindow, async () => {
      throw new Error('boom');
    });
    await expect(invoke('llm:classify', 10)).rejects.toThrow('boom');
  });
});

describe('streaming handlers', () => {
  function setup(getWindow: WindowGetter) {
    const container = {
      deps: {
        emails: {
          findById: vi.fn(async () => ({
            id: 1,
            subject: 'Hello',
            date: new Date('2026-01-01T00:00:00Z'),
            snippet: 'snip',
            from: { address: 'a@b.c', name: 'A' },
          })),
          getBody: vi.fn(async () => ({ text: 'body' })),
        },
        secrets: {},
      },
      config: { get: vi.fn(() => ({ provider: 'anthropic', model: 'm' })) },
    } as unknown as Container;
    setupStreamingHandlers(container, getWindow);
  }

  async function startStream() {
    const result = (await invoke('llm:streamExplain', { emailId: 1 })) as { requestId: string };
    return `llm:stream:${result.requestId}`;
  }

  it('streams events to the current window on the per-request channel and stops at done', async () => {
    const win = makeWindow();
    setup(makeGetter(win).getWindow);
    const seen: string[] = [];
    classifyStreaming.mockImplementation(async function* () {
      yield { type: 'delta', text: 'a' };
      yield { type: 'done' };
      seen.push('after-done');
      yield { type: 'delta', text: 'never' };
    });

    const channel = await startStream();
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(2));
    expect(win.webContents.send).toHaveBeenNthCalledWith(1, channel, { type: 'delta', text: 'a' });
    expect(win.webContents.send).toHaveBeenNthCalledWith(2, channel, { type: 'done' });
    expect(seen).toEqual([]);
  });

  it('stops consuming the stream once the window is gone', async () => {
    const win = makeWindow();
    const g = makeGetter(win);
    setup(g.getWindow);
    let produced = 0;
    classifyStreaming.mockImplementation(async function* () {
      produced++;
      yield { type: 'delta', text: '1' };
      // The user closes the window mid-stream.
      g.set(null);
      produced++;
      yield { type: 'delta', text: '2' };
      produced++;
      yield { type: 'delta', text: '3' };
    });

    await startStream();
    await vi.waitFor(() => expect(produced).toBe(2));
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a failing stream has no window to report to', async () => {
    setup(makeGetter(null).getWindow);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    classifyStreaming.mockImplementation(async function* () {
      yield { type: 'delta', text: 'x' };
      throw new Error('network');
    });

    try {
      await expect(startStream()).resolves.toMatch(/^llm:stream:/);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('reports a stream failure to the current window', async () => {
    const win = makeWindow();
    setup(makeGetter(win).getWindow);
    classifyStreaming.mockImplementation(async function* () {
      yield* [];
      throw new Error('network');
    });

    const channel = await startStream();
    await vi.waitFor(() =>
      expect(win.webContents.send).toHaveBeenCalledWith(channel, {
        type: 'error',
        message: 'network',
      }),
    );
  });
});
