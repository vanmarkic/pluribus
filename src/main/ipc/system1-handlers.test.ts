/**
 * IPC tests for the System 1 additions: model import from a folder (the
 * directory picker is injectable / mocked) and the `system1` config section.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  dialog: { showOpenDialog },
}));

import { setupSystem1Handlers } from './system1-handlers';
import { setupConfigHandlers } from './config-handlers';
import { DEFAULT_SYSTEM1_SETTINGS } from '../../core/domain';
import type { Container } from '../container';
import type { RendererWindow } from '../window-manager';

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return Promise.resolve().then(() => fn({}, ...args));
};

function makeContainer() {
  const useCases = {
    getSystem1Status: vi.fn(async () => ({ embeddingModel: 'm', heads: [] })),
    trainSystem1: vi.fn(async () => ({ embeddingModel: 'm', heads: [] })),
  };
  const store: Record<string, unknown> = {
    llm: { provider: 'ollama' },
    system1: { ...DEFAULT_SYSTEM1_SETTINGS },
  };
  const config = {
    get: vi.fn((key: string) => store[key]),
    set: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
  };
  const container = { useCases, config } as unknown as Container;
  return { container, useCases, config, store };
}

const fakeWindow = (): RendererWindow => ({
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
});

beforeEach(() => {
  handlers.clear();
  showOpenDialog.mockReset();
});

describe('system1:importModel', () => {
  const summary = { model: 'Xenova/multilingual-e5-small', files: 5, bytes: 123_456_789 };

  it('opens a directory picker on the current window and imports the chosen folder', async () => {
    const { container } = makeContainer();
    const importModel = vi.fn(async () => summary);
    const win = fakeWindow();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/me/models/e5'] });
    setupSystem1Handlers(container, { getWindow: () => win, importModel });

    await expect(invoke('system1:importModel')).resolves.toEqual({
      status: 'imported',
      ...summary,
    });

    expect(importModel).toHaveBeenCalledWith('/Users/me/models/e5');
    const [parent, options] = showOpenDialog.mock.calls[0]!;
    expect(parent).toBe(win);
    expect(options.properties).toEqual(['openDirectory']);
  });

  it('still opens the picker (unparented) when there is no window', async () => {
    const { container } = makeContainer();
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    setupSystem1Handlers(container, { getWindow: () => null, importModel: vi.fn() });

    await invoke('system1:importModel');

    expect(showOpenDialog).toHaveBeenCalledTimes(1);
    expect(showOpenDialog.mock.calls[0]).toHaveLength(1); // options only, no parent
  });

  it('does nothing when the picker is cancelled', async () => {
    const { container } = makeContainer();
    const importModel = vi.fn();
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    setupSystem1Handlers(container, { importModel });

    await expect(invoke('system1:importModel')).resolves.toEqual({ status: 'cancelled' });
    expect(importModel).not.toHaveBeenCalled();
  });

  it('reports validation errors from the import to the renderer', async () => {
    const { container } = makeContainer();
    const importModel = vi.fn(async () => {
      throw new Error('This folder is not a model. Missing: tokenizer.json');
    });
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/x'] });
    setupSystem1Handlers(container, { importModel });

    await expect(invoke('system1:importModel')).rejects.toThrow(/Missing: tokenizer\.json/);
  });

  it('takes an injected picker instead of the Electron dialog', async () => {
    const { container } = makeContainer();
    const importModel = vi.fn(async () => summary);
    const picker = vi.fn(async () => ({ canceled: false, filePaths: ['/picked'] }));
    setupSystem1Handlers(container, { importModel, showOpenDialog: picker });

    await invoke('system1:importModel');

    expect(picker).toHaveBeenCalledTimes(1);
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(importModel).toHaveBeenCalledWith('/picked');
  });

  it('fails clearly when the runtime has not wired model import', async () => {
    const { container } = makeContainer();
    setupSystem1Handlers(container);
    await expect(invoke('system1:importModel')).rejects.toThrow(/not available/i);
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('ignores any argument the renderer sends (the folder is only ever chosen in the picker)', async () => {
    const { container } = makeContainer();
    const importModel = vi.fn(async () => summary);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    setupSystem1Handlers(container, { importModel });

    await invoke('system1:importModel', '/etc');

    expect(importModel).toHaveBeenCalledWith('/picked');
  });
});

describe('system1 status and retrain', () => {
  it('keep working with no options', async () => {
    const { container, useCases } = makeContainer();
    setupSystem1Handlers(container);
    await invoke('system1:getStatus');
    await invoke('system1:retrain');
    expect(useCases.getSystem1Status).toHaveBeenCalledTimes(1);
    expect(useCases.trainSystem1).toHaveBeenCalledTimes(1);
  });
});

describe("config 'system1'", () => {
  it('is readable', async () => {
    const { container } = makeContainer();
    setupConfigHandlers(container);
    await expect(invoke('config:get', 'system1')).resolves.toEqual(DEFAULT_SYSTEM1_SETTINGS);
  });

  it('merges a partial update into the stored settings', async () => {
    const { container, config, store } = makeContainer();
    setupConfigHandlers(container);

    await invoke('config:set', 'system1', { enabled: false });

    expect(config.set).toHaveBeenCalledWith('system1', {
      ...DEFAULT_SYSTEM1_SETTINGS,
      enabled: false,
    });
    expect(store.system1).toEqual({ ...DEFAULT_SYSTEM1_SETTINGS, enabled: false });

    await invoke('config:set', 'system1', { auditRate: 0.1, targetDisagreement: 0.02 });
    expect(store.system1).toEqual({
      ...DEFAULT_SYSTEM1_SETTINGS,
      enabled: false,
      auditRate: 0.1,
      targetDisagreement: 0.02,
    });
  });

  it('accepts every allowlisted encoder', async () => {
    const { container, store } = makeContainer();
    setupConfigHandlers(container);
    await invoke('config:set', 'system1', {
      embeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    });
    expect((store.system1 as { embeddingModel: string }).embeddingModel).toBe(
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    );
  });

  it.each([
    [{ embeddingModel: 'attacker/model' }, /embeddingModel/],
    [{ embeddingModel: '../../outside' }, /embeddingModel/],
    [{ targetDisagreement: 0.5 }, /targetDisagreement/],
    [{ targetDisagreement: 0 }, /targetDisagreement/],
    [{ auditRate: 0.9 }, /auditRate/],
    [{ auditRate: -1 }, /auditRate/],
    [{ enabled: 'yes' }, /enabled/],
    [{ cacheDir: '/tmp' }, /Invalid/],
    [null, /Invalid/],
    ['on', /Invalid/],
  ])('rejects %j without saving anything', async (bad, message) => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);
    await expect(invoke('config:set', 'system1', bad)).rejects.toThrow(message);
    expect(config.set).not.toHaveBeenCalled();
  });

  it('keeps unrelated keys off the allowlist', async () => {
    const { container } = makeContainer();
    setupConfigHandlers(container);
    await expect(invoke('config:get', 'digestState')).rejects.toThrow(/not allowed/);
  });
});
