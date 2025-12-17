/**
 * Sync IPC Handlers
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertBoolean,
  assertString,
  checkRateLimit,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupSyncHandlers(container: Container, window: BrowserWindow): void {
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

  // Forward sync progress to renderer
  deps.sync.onProgress((progress) => {
    window.webContents.send('sync:progress', progress);
  });
}
