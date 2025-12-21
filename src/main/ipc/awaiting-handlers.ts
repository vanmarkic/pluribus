/**
 * Awaiting Reply IPC Handlers
 *
 * Manages "awaiting reply" status for sent emails.
 * Uses local Ollama qwen2.5:1.5b for classification.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertString,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupAwaitingHandlers(container: Container): void {
  const { useCases } = container;

  // Check if email body expects a reply (uses LLM)
  ipcMain.handle('awaiting:shouldTrack', async (_, body) => {
    const b = assertString(body, 'body', 10000);
    return useCases.shouldTrackAwaiting(b);
  });

  // Mark an email as awaiting reply
  ipcMain.handle('awaiting:mark', async (_, emailId) => {
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.markAwaiting(id);
  });

  // Clear awaiting status from an email
  ipcMain.handle('awaiting:clear', async (_, emailId) => {
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.clearAwaiting(id);
  });

  // Clear awaiting status when a reply is received
  ipcMain.handle('awaiting:clearByReply', async (_, inReplyToMessageId) => {
    const messageId = assertString(inReplyToMessageId, 'inReplyToMessageId', 500);
    return useCases.clearAwaitingByReply(messageId);
  });

  // Get list of emails awaiting reply for an account
  ipcMain.handle('awaiting:list', async (_, accountId) => {
    const id = assertPositiveInt(accountId, 'accountId');
    return useCases.getAwaitingList(id);
  });

  // Toggle awaiting status for an email
  ipcMain.handle('awaiting:toggle', async (_, emailId) => {
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.toggleAwaiting(id);
  });
}
