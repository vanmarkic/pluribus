/**
 * Thread IPC Handlers
 *
 * Provides IPC handlers for email threading operations:
 * - threads:list - Get threaded email list for folder
 * - threads:messages - Get all messages in a thread
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { assertPositiveInt, assertString } from './validation';

export function setupThreadHandlers(container: Container): void {
  const { useCases } = container;

  // Get threaded email list for a folder
  ipcMain.handle('threads:list', async (_, accountId, folderId) => {
    const aId = assertPositiveInt(accountId, 'accountId');
    const fId = assertPositiveInt(folderId, 'folderId');
    return useCases.getThreadedEmails(aId, fId);
  });

  // Get all messages in a thread
  ipcMain.handle('threads:messages', async (_, threadId) => {
    const tid = assertString(threadId, 'threadId', 500);
    return useCases.getThreadMessages(tid);
  });
}
