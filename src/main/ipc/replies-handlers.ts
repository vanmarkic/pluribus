/**
 * "Needs your reply" IPC handlers.
 *
 * Thin boundary: validate inputs with zod, then call the use cases.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  ReplyBackfillAccountInput,
  ReplyEmailIdInput,
  ReplySnoozeHoursInput,
  parseInput,
} from './schemas';
import { checkRateLimit } from './validation';

const HOUR_MS = 60 * 60 * 1000;

export function setupRepliesHandlers(container: Container): void {
  const { useCases } = container;

  ipcMain.handle('replies:list', async () => {
    return useCases.listForgottenReplies();
  });

  ipcMain.handle('replies:done', async (_event, emailId: unknown) => {
    await useCases.markReplyDone(parseInput(ReplyEmailIdInput, emailId, 'emailId'));
  });

  ipcMain.handle('replies:snooze', async (_event, emailId: unknown, hours: unknown) => {
    const id = parseInput(ReplyEmailIdInput, emailId, 'emailId');
    const h = parseInput(ReplySnoozeHoursInput, hours, 'hours');
    await useCases.snoozeReply(id, new Date(Date.now() + h * HOUR_MS));
  });

  ipcMain.handle('replies:dismiss', async (_event, emailId: unknown) => {
    await useCases.dismissReply(parseInput(ReplyEmailIdInput, emailId, 'emailId'));
  });

  ipcMain.handle('replies:backfill', async (_event, accountId: unknown) => {
    checkRateLimit('replies:backfill', 10);
    const id = parseInput(ReplyBackfillAccountInput, accountId, 'accountId');
    return useCases.backfillReplySignals({ accountId: id });
  });
}
