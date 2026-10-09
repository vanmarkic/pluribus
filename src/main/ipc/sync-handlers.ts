/**
 * Sync IPC Handlers
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { sendToRenderer, type WindowGetter } from '../window-manager';
import {
  assertPositiveInt,
  assertBoolean,
  assertString,
  checkRateLimit,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupSyncHandlers(container: Container, getWindow: WindowGetter): void {
  const { useCases, deps } = container;

  ipcMain.handle('sync:start', async (_, accountId, opts) => {
    checkRateLimit('sync:start', 10);
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.headersOnly !== undefined) validated.headersOnly = assertBoolean(o.headersOnly, 'headersOnly');
      if (o.batchSize !== undefined) validated.batchSize = assertPositiveInt(o.batchSize, 'batchSize');
      if (o.maxMessages !== undefined) validated.maxMessages = assertPositiveInt(o.maxMessages, 'maxMessages');
      if (o.folder !== undefined) validated.folder = assertString(o.folder, 'folder', 200);
    }

    // Use the combined use case (handles auto-classify based on config)
    return useCases.syncWithAutoClassify(assertPositiveInt(accountId, 'accountId'), validated);
  });

  ipcMain.handle('sync:startAll', async (_, opts) => {
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.headersOnly !== undefined) validated.headersOnly = assertBoolean(o.headersOnly, 'headersOnly');
    }

    // Use the combined use case (handles auto-classify based on config)
    return useCases.syncAllWithAutoClassify(validated);
  });

  ipcMain.handle('sync:cancel', async (_, accountId) => {
    return useCases.cancelSync(assertPositiveInt(accountId, 'accountId'));
  });

  // Forward sync progress to the renderer. The window is looked up per event:
  // sync can outlive the window (macOS keeps the app running without one).
  deps.sync.onProgress((progress) => {
    sendToRenderer(getWindow, 'sync:progress', progress);
  });
}
