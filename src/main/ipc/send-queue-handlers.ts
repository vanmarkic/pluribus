/**
 * Send Queue IPC Handlers
 *
 * Provides IPC handlers for delayed email sending:
 * - send:queue - Queue an email for delayed sending
 * - send:cancel - Cancel a queued email
 * - send:status - Get status of a queued email
 *
 * NOTE: Requires send-queue adapter to be wired in container.
 * This handler file is ready for when the adapter is implemented.
 */

import { ipcMain } from 'electron';
import { assertPositiveInt, assertString } from './validation';

// Send queue type (to be moved to ports when adapter is implemented)
export type QueuedEmail = {
  id: string;
  accountId: number;
  draft: any;
  expiresAt: Date;
  status: 'pending' | 'sent' | 'cancelled';
};

export type SendQueue = {
  queue: (accountId: number, draft: any) => QueuedEmail;
  cancel: (id: string) => boolean;
  getStatus: (id: string) => QueuedEmail | null;
};

export function setupSendQueueHandlers(sendQueue: SendQueue): void {
  // Queue an email for delayed sending
  ipcMain.handle('send:queue', async (_, accountId, draft) => {
    const aId = assertPositiveInt(accountId, 'accountId');
    const result = sendQueue.queue(aId, draft);
    return {
      id: result.id,
      expiresAt: result.expiresAt.toISOString(),
    };
  });

  // Cancel a queued email
  ipcMain.handle('send:cancel', async (_, id) => {
    const queueId = assertString(id, 'id', 100);
    return sendQueue.cancel(queueId);
  });

  // Get status of a queued email
  ipcMain.handle('send:status', async (_, id) => {
    const queueId = assertString(id, 'id', 100);
    const status = sendQueue.getStatus(queueId);
    if (!status) return null;
    return {
      ...status,
      expiresAt: status.expiresAt.toISOString(),
    };
  });
}
