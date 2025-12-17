/**
 * Email & Attachment IPC Handlers
 */

import { ipcMain, shell, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import sanitizeFilename = require('sanitize-filename');
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertBoolean,
  assertString,
  assertOptionalPositiveInt,
  assertListOptions,
  checkRateLimit,
} from './validation';

// ==========================================
// Temp File Tracking
// ==========================================

const tempFiles = new Set<string>();

export function getTempFiles(): Set<string> {
  return tempFiles;
}

// ==========================================
// Setup Function
// ==========================================

export function setupEmailHandlers(container: Container): void {
  const { useCases, deps } = container;

  // ==========================================
  // Emails
  // ==========================================

  ipcMain.handle('emails:list', (_, opts) => {
    const validated = assertListOptions(opts);
    return useCases.listEmails(validated);
  });

  ipcMain.handle('emails:get', (_, id) => {
    return useCases.getEmail(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:getBody', (_, id) => {
    return useCases.getEmailBody(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:search', (_, query, limit, accountId) => {
    const q = assertString(query, 'query', 500);
    const l = assertOptionalPositiveInt(limit, 'limit') ?? 100;
    const aId = assertOptionalPositiveInt(accountId, 'accountId');
    return useCases.searchEmails(q, l, aId);
  });

  ipcMain.handle('emails:markRead', (_, id, isRead) => {
    return useCases.markRead(assertPositiveInt(id, 'id'), assertBoolean(isRead, 'isRead'));
  });

  ipcMain.handle('emails:star', (_, id, isStarred) => {
    return useCases.starEmail(assertPositiveInt(id, 'id'), assertBoolean(isStarred, 'isStarred'));
  });

  ipcMain.handle('emails:archive', (_, id) => {
    return useCases.archiveEmail(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:unarchive', (_, id) => {
    return useCases.unarchiveEmail(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:delete', (_, id) => {
    return useCases.deleteEmail(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:trash', (_, id) => {
    return useCases.trashEmail(assertPositiveInt(id, 'id'));
  });

  // ==========================================
  // Attachments
  // ==========================================

  ipcMain.handle('attachments:getForEmail', (_, emailId) => {
    return deps.attachments.findByEmailId(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('attachments:download', async (_, attachmentId, action) => {
    checkRateLimit('attachments:download', 30);
    const id = assertPositiveInt(attachmentId, 'attachmentId');
    const actionType = action ? assertString(action, 'action', 10) : 'open';
    if (!['open', 'save'].includes(actionType)) throw new Error('Invalid action');

    // Get attachment metadata and content
    const attachment = await deps.attachments.findById(id);
    if (!attachment) throw new Error('Attachment not found');

    const content = await deps.attachments.getContent(id);
    if (!content) throw new Error('Attachment content not found');

    // Save to temp directory
    const tempDir = path.join(app.getPath('temp'), 'mail-attachments');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Sanitize filename to prevent path traversal attacks
    const safeFilename = sanitizeFilename(attachment.filename, { replacement: '_' });
    if (!safeFilename) throw new Error('Invalid attachment filename');
    const tempPath = path.join(tempDir, `${id}-${safeFilename}`);

    fs.writeFileSync(tempPath, content);
    tempFiles.add(tempPath);

    if (actionType === 'open') {
      await shell.openPath(tempPath);
      return { path: tempPath, action: 'opened' };
    } else {
      // For save, we could use dialog.showSaveDialog here
      // For now, just return the temp path
      return { path: tempPath, action: 'saved' };
    }
  });
}
