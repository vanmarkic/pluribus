/**
 * IPC boundary tests for the reply digest, daily digest, System 1 and
 * config handlers: inputs are validated, valid calls reach the use cases, and
 * internal digest state is never exposed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

import { setupRepliesHandlers } from './replies-handlers';
import { setupDigestHandlers } from './digest-handlers';
import { setupSystem1Handlers } from './system1-handlers';
import { setupConfigHandlers } from './config-handlers';
import type { Container } from '../container';

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return Promise.resolve().then(() => fn({}, ...args));
};

const STORED_DIGEST = {
  enabled: true,
  time: '09:00',
  graceHours: 24,
  lookbackDays: 14,
  maxItems: 10,
  minImportance: 2,
  emailToSelf: true,
  showSubjects: false,
  allowBiometricPrompt: false,
  launchAtLogin: false,
};

function makeContainer() {
  const useCases = {
    listForgottenReplies: vi.fn(async () => [{ accountId: 1 }]),
    markReplyDone: vi.fn(async () => {}),
    snoozeReply: vi.fn(async () => {}),
    dismissReply: vi.fn(async () => {}),
    backfillReplySignals: vi.fn(async () => ({ processed: 2, skipped: 1 })),
    runDailyDigest: vi.fn(async () => ({ totalItems: 0 })),
    getSystem1Status: vi.fn(async () => ({ embeddingModel: 'm', heads: [] })),
    trainSystem1: vi.fn(async () => ({ embeddingModel: 'm', heads: [] })),
  };
  const digestOpen = { markPending: vi.fn(), consume: vi.fn(() => true) };
  const store: Record<string, unknown> = {
    llm: { provider: 'ollama' },
    digest: { ...STORED_DIGEST },
    digestState: { lastRunDate: '2026-01-01', pendingEmailAccountIds: [1] },
  };
  const config = {
    get: vi.fn((key: string) => store[key]),
    set: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
  };
  const container = { useCases, digestOpen, config } as unknown as Container;
  return { container, useCases, digestOpen, config, store };
}

beforeEach(() => {
  handlers.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('replies handlers', () => {
  it('replies:list returns the forgotten replies', async () => {
    const { container, useCases } = makeContainer();
    setupRepliesHandlers(container);
    await expect(invoke('replies:list')).resolves.toEqual([{ accountId: 1 }]);
    expect(useCases.listForgottenReplies).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['replies:done', 'markReplyDone'],
    ['replies:dismiss', 'dismissReply'],
  ] as const)('%s validates the email id and calls %s', async (channel, useCase) => {
    const { container, useCases } = makeContainer();
    setupRepliesHandlers(container);

    await expect(invoke(channel, 7)).resolves.toBeUndefined();
    expect(useCases[useCase]).toHaveBeenCalledWith(7);

    for (const bad of [0, -1, 1.5, '7', null, undefined]) {
      await expect(invoke(channel, bad)).rejects.toThrow(/Invalid emailId/);
    }
    expect(useCases[useCase]).toHaveBeenCalledTimes(1);
  });

  it('replies:snooze converts hours to a wake-up time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T09:00:00.000Z'));
    const { container, useCases } = makeContainer();
    setupRepliesHandlers(container);

    await invoke('replies:snooze', 5, 24);
    expect(useCases.snoozeReply).toHaveBeenCalledWith(5, new Date('2026-06-02T09:00:00.000Z'));
  });

  it('replies:snooze rejects bad ids and hours outside 1..720', async () => {
    const { container, useCases } = makeContainer();
    setupRepliesHandlers(container);

    await expect(invoke('replies:snooze', 0, 24)).rejects.toThrow(/Invalid emailId/);
    for (const hours of [0, 721, 1.5, '24', undefined]) {
      await expect(invoke('replies:snooze', 5, hours)).rejects.toThrow(/Invalid hours/);
    }
    expect(useCases.snoozeReply).not.toHaveBeenCalled();
  });

  it('replies:backfill validates the account id and returns the counts', async () => {
    const { container, useCases } = makeContainer();
    setupRepliesHandlers(container);

    await expect(invoke('replies:backfill', 3)).resolves.toEqual({ processed: 2, skipped: 1 });
    expect(useCases.backfillReplySignals).toHaveBeenCalledWith({ accountId: 3 });
    await expect(invoke('replies:backfill', 'x')).rejects.toThrow(/Invalid accountId/);
  });
});

describe('digest handlers', () => {
  it('digest:runNow runs a manual digest', async () => {
    const { container, useCases } = makeContainer();
    setupDigestHandlers(container);
    await invoke('digest:runNow');
    expect(useCases.runDailyDigest).toHaveBeenCalledWith({ trigger: 'manual' });
  });

  it('digest:sendTest runs a test digest', async () => {
    const { container, useCases } = makeContainer();
    setupDigestHandlers(container);
    await invoke('digest:sendTest');
    expect(useCases.runDailyDigest).toHaveBeenCalledWith({ trigger: 'test' });
  });

  it('digest:consumePendingOpen reads the in-memory flag', async () => {
    const { container, digestOpen } = makeContainer();
    setupDigestHandlers(container);
    await expect(invoke('digest:consumePendingOpen')).resolves.toBe(true);
    expect(digestOpen.consume).toHaveBeenCalledTimes(1);
  });
});

describe('system1 handlers', () => {
  it('forwards status and retrain to the use cases', async () => {
    const { container, useCases } = makeContainer();
    setupSystem1Handlers(container);
    await expect(invoke('system1:getStatus')).resolves.toEqual({ embeddingModel: 'm', heads: [] });
    await expect(invoke('system1:retrain')).resolves.toEqual({ embeddingModel: 'm', heads: [] });
    expect(useCases.getSystem1Status).toHaveBeenCalledTimes(1);
    expect(useCases.trainSystem1).toHaveBeenCalledTimes(1);
  });
});

describe('config handlers: digest section', () => {
  it('config:get exposes the digest settings', async () => {
    const { container } = makeContainer();
    setupConfigHandlers(container);
    await expect(invoke('config:get', 'digest')).resolves.toEqual(STORED_DIGEST);
  });

  it('never exposes digestState', async () => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);

    await expect(invoke('config:get', 'digestState')).rejects.toThrow(/not allowed/);
    await expect(
      invoke('config:set', 'digestState', { lastRunDate: null, pendingEmailAccountIds: [] }),
    ).rejects.toThrow(/not allowed/);
    expect(config.set).not.toHaveBeenCalled();
  });

  it('config:set merges a partial digest update into the stored settings', async () => {
    const { container, config, store } = makeContainer();
    setupConfigHandlers(container);

    await invoke('config:set', 'digest', { time: '07:45', showSubjects: true });

    expect(config.set).toHaveBeenCalledWith('digest', {
      ...STORED_DIGEST,
      time: '07:45',
      showSubjects: true,
    });
    expect(store.digestState).toEqual({ lastRunDate: '2026-01-01', pendingEmailAccountIds: [1] });
  });

  it('config:set keeps a false boolean instead of falling back to the stored value', async () => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);

    await invoke('config:set', 'digest', { enabled: false, emailToSelf: false });
    expect(config.set).toHaveBeenCalledWith(
      'digest',
      expect.objectContaining({ enabled: false, emailToSelf: false }),
    );
  });

  it('config:set stores minImportance and launchAtLogin, and can switch launchAtLogin off', async () => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);

    await invoke('config:set', 'digest', { minImportance: 4 });
    expect(config.set).toHaveBeenLastCalledWith(
      'digest',
      expect.objectContaining({ minImportance: 4, launchAtLogin: false }),
    );

    // Switching it ON then OFF: the explicit `false` must win over the stored value.
    const second = makeContainer();
    second.store.digest = { ...STORED_DIGEST, launchAtLogin: true };
    setupConfigHandlers(second.container);
    await invoke('config:set', 'digest', { launchAtLogin: false });
    expect(second.config.set).toHaveBeenLastCalledWith(
      'digest',
      expect.objectContaining({ launchAtLogin: false }),
    );
  });

  it('config:set rejects invalid digest values without writing', async () => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);

    const bad: unknown[] = [
      { time: '25:00' },
      { time: '9:00' },
      { graceHours: 0 },
      { graceHours: 337 },
      { lookbackDays: 91 },
      { maxItems: 51 },
      { minImportance: 1 },
      { minImportance: 5 },
      { launchAtLogin: 'yes' },
      { enabled: 'true' },
      { lastRunDate: '2026-01-01' },
      null,
      'digest',
    ];
    for (const value of bad) {
      await expect(invoke('config:set', 'digest', value)).rejects.toThrow(/Invalid/);
    }
    expect(config.set).not.toHaveBeenCalled();
  });
});

describe('config handlers: llm.sendBodyExcerptsToCloud', () => {
  it('accepts a boolean', async () => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);

    const value = { provider: 'anthropic', sendBodyExcerptsToCloud: true };
    await invoke('config:set', 'llm', value);
    expect(config.set).toHaveBeenCalledWith('llm', value);
  });

  it('rejects a non-boolean', async () => {
    const { container, config } = makeContainer();
    setupConfigHandlers(container);

    for (const bad of ['yes', 1, null]) {
      await expect(invoke('config:set', 'llm', { sendBodyExcerptsToCloud: bad })).rejects.toThrow(
        /Invalid/,
      );
    }
    expect(config.set).not.toHaveBeenCalled();
  });
});
