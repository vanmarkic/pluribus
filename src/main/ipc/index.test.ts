/**
 * registerIpcHandlers is called once per process: ipcMain.handle throws on a
 * duplicate channel, so a second registration (e.g. a re-created window on
 * macOS) must fail loudly and clearly instead of half-registering. Handlers
 * that push events to the renderer receive a window *getter*, never a window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container } from '../container';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

// Every handler module is replaced by a spy: this test is about the
// orchestration (what gets called, how often, with what), not the channels.
vi.mock('./email-handlers', () => ({
  setupEmailHandlers: vi.fn(),
  getTempFiles: vi.fn(() => new Set<string>()),
}));
vi.mock('./sync-handlers', () => ({ setupSyncHandlers: vi.fn() }));
vi.mock('./classification-handlers', () => ({ setupClassificationHandlers: vi.fn() }));
vi.mock('./account-handlers', () => ({ setupAccountHandlers: vi.fn() }));
vi.mock('./send-handlers', () => ({ setupSendHandlers: vi.fn() }));
vi.mock('./config-handlers', () => ({ setupConfigHandlers: vi.fn() }));
vi.mock('./content-handlers', () => ({ setupContentHandlers: vi.fn() }));
vi.mock('./system-handlers', () => ({ setupSystemHandlers: vi.fn() }));
vi.mock('./triage-handlers', () => ({ setupTriageHandlers: vi.fn() }));
vi.mock('./awaiting-handlers', () => ({ setupAwaitingHandlers: vi.fn() }));
vi.mock('./thread-handlers', () => ({ setupThreadHandlers: vi.fn() }));
vi.mock('./unsubscribe-handlers', () => ({ setupUnsubscribeHandlers: vi.fn() }));
vi.mock('./send-queue-handlers', () => ({ setupSendQueueHandlers: vi.fn() }));
vi.mock('./llm-calls-handlers', () => ({ setupLlmCallsHandlers: vi.fn() }));
vi.mock('./embedding-handlers', () => ({ setupEmbeddingHandlers: vi.fn() }));
vi.mock('./security-events-handlers', () => ({ setupSecurityEventsHandlers: vi.fn() }));
vi.mock('./streaming-handlers', () => ({ setupStreamingHandlers: vi.fn() }));
vi.mock('./calibration-handlers', () => ({ setupCalibrationHandlers: vi.fn() }));
vi.mock('./body-migration-handlers', () => ({ setupBodyMigrationHandlers: vi.fn() }));
vi.mock('./replies-handlers', () => ({ setupRepliesHandlers: vi.fn() }));
vi.mock('./digest-handlers', () => ({ setupDigestHandlers: vi.fn() }));
vi.mock('./system1-handlers', () => ({ setupSystem1Handlers: vi.fn() }));

const container = { sendQueue: { kind: 'send-queue' } } as unknown as Container;

/**
 * The "already registered" flag lives in module scope, so each test loads a
 * fresh copy of the module (and of its mocked handler modules).
 */
async function load() {
  vi.resetModules();
  const ipc = await import('./index');
  const sync = await import('./sync-handlers');
  const classification = await import('./classification-handlers');
  const streaming = await import('./streaming-handlers');
  const email = await import('./email-handlers');
  const sendQueue = await import('./send-queue-handlers');
  const system1 = await import('./system1-handlers');
  return { ipc, sync, classification, streaming, email, sendQueue, system1 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerIpcHandlers', () => {
  it('registers every handler group once', async () => {
    const { ipc, email, system1, sendQueue } = await load();
    ipc.registerIpcHandlers(() => null, container);

    expect(email.setupEmailHandlers).toHaveBeenCalledTimes(1);
    expect(system1.setupSystem1Handlers).toHaveBeenCalledTimes(1);
    expect(sendQueue.setupSendQueueHandlers).toHaveBeenCalledWith(container.sendQueue);
  });

  it('hands the window getter itself to the handlers that push events', async () => {
    const { ipc, sync, classification, streaming } = await load();
    const getWindow = vi.fn(() => null);
    ipc.registerIpcHandlers(getWindow, container);

    expect(sync.setupSyncHandlers).toHaveBeenCalledWith(container, getWindow);
    expect(classification.setupClassificationHandlers).toHaveBeenCalledWith(container, getWindow);
    expect(streaming.setupStreamingHandlers).toHaveBeenCalledWith(container, getWindow);
    // Registering must not resolve the window: none exists yet at startup.
    expect(getWindow).not.toHaveBeenCalled();
  });

  it('hands the System 1 runtime actions (model import and download) to the System 1 handlers', async () => {
    const { ipc, system1 } = await load();
    const importModel = vi.fn();
    const downloadModel = vi.fn();
    ipc.registerIpcHandlers(() => null, container, { importModel, downloadModel });

    expect(system1.setupSystem1Handlers).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ importModel, downloadModel }),
    );
  });

  it('wires neither System 1 action when the runtime provides none', async () => {
    const { ipc, system1 } = await load();
    ipc.registerIpcHandlers(() => null, container);

    const options = vi.mocked(system1.setupSystem1Handlers).mock.calls[0]![1]!;
    expect(options).not.toHaveProperty('importModel');
    expect(options).not.toHaveProperty('downloadModel');
  });

  it('throws a clear error when called a second time and registers nothing again', async () => {
    const { ipc, email, sync } = await load();
    ipc.registerIpcHandlers(() => null, container);

    expect(() => ipc.registerIpcHandlers(() => null, container)).toThrow(
      /IPC handlers (are )?already registered/i,
    );
    expect(email.setupEmailHandlers).toHaveBeenCalledTimes(1);
    expect(sync.setupSyncHandlers).toHaveBeenCalledTimes(1);
  });

  it('still refuses a second registration with a different container or getter', async () => {
    const { ipc } = await load();
    ipc.registerIpcHandlers(() => null, container);
    const other = { sendQueue: {} } as unknown as Container;
    expect(() => ipc.registerIpcHandlers(() => null, other)).toThrow(/already registered/i);
  });

  it('a fresh process (module) can register again', async () => {
    const first = await load();
    first.ipc.registerIpcHandlers(() => null, container);
    const second = await load();
    expect(() => second.ipc.registerIpcHandlers(() => null, container)).not.toThrow();
  });
});
