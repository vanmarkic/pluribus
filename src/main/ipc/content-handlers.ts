/**
 * Content IPC Handlers (Images, Drafts, Contacts)
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import type { DraftInput } from '../../core/domain';
import {
  assertPositiveInt,
  assertNonNegativeInt,
  assertString,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupContentHandlers(container: Container): void {
  const { useCases } = container;

  // ==========================================
  // Remote Images
  // ==========================================

  ipcMain.handle('images:getSetting', () => {
    return useCases.getRemoteImagesSetting();
  });

  ipcMain.handle('images:setSetting', (_, setting) => {
    const validSettings = ['block', 'allow', 'auto'];
    const s = assertString(setting, 'setting', 10);
    if (!validSettings.includes(s)) throw new Error('Invalid setting');
    return useCases.setRemoteImagesSetting(s as 'block' | 'allow' | 'auto');
  });

  ipcMain.handle('images:hasLoaded', (_, emailId) => {
    return useCases.hasLoadedRemoteImages(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('images:load', async (_, emailId, urls) => {
    const id = assertPositiveInt(emailId, 'emailId');
    if (!Array.isArray(urls)) throw new Error('Invalid urls: must be an array');
    const validatedUrls = urls.map((url, i) => assertString(url, `urls[${i}]`, 2000));
    return useCases.loadRemoteImages(id, validatedUrls);
  });

  ipcMain.handle('images:clearCache', (_, emailId) => {
    return useCases.clearImageCache(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('images:clearAllCache', () => {
    return useCases.clearAllImageCache();
  });

  ipcMain.handle('images:autoLoad', async (_, emailId, urls) => {
    const id = assertPositiveInt(emailId, 'emailId');
    if (!Array.isArray(urls)) throw new Error('Invalid urls: must be an array');
    const validatedUrls = urls.map((url, i) => assertString(url, `urls[${i}]`, 2000));
    return useCases.autoLoadImagesForEmail(id, validatedUrls);
  });

  // ==========================================
  // Drafts
  // ==========================================

  ipcMain.handle('drafts:list', (_, opts) => {
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.accountId !== undefined) validated.accountId = assertPositiveInt(o.accountId, 'accountId');
    }
    return useCases.listDrafts(validated);
  });

  ipcMain.handle('drafts:get', (_, id) => {
    return useCases.getDraft(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('drafts:save', (_, draft) => {
    if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
    const d = draft as Record<string, unknown>;

    const validated: Record<string, unknown> = {
      accountId: assertPositiveInt(d.accountId, 'accountId'),
    };

    if (d.id !== undefined) validated.id = assertPositiveInt(d.id, 'id');
    if (Array.isArray(d.to)) validated.to = (d.to as string[]).map(addr => assertString(addr, 'to', 200));
    if (Array.isArray(d.cc)) validated.cc = (d.cc as string[]).map(addr => assertString(addr, 'cc', 200));
    if (Array.isArray(d.bcc)) validated.bcc = (d.bcc as string[]).map(addr => assertString(addr, 'bcc', 200));
    if (d.subject !== undefined) validated.subject = assertString(d.subject, 'subject', 500);
    if (d.text !== undefined) validated.text = assertString(d.text, 'text', 100000);
    if (d.html !== undefined) validated.html = assertString(d.html, 'html', 500000);
    if (d.inReplyTo !== undefined) validated.inReplyTo = assertString(d.inReplyTo, 'inReplyTo', 500);
    if (Array.isArray(d.references)) validated.references = (d.references as string[]).map(r => assertString(r, 'reference', 500));
    if (d.originalEmailId !== undefined) validated.originalEmailId = assertPositiveInt(d.originalEmailId, 'originalEmailId');

    // Validate attachments
    if (Array.isArray(d.attachments)) {
      validated.attachments = (d.attachments as Record<string, unknown>[]).map((att, i) => {
        if (!att || typeof att !== 'object') throw new Error(`Invalid attachment at index ${i}`);
        return {
          filename: assertString(att.filename, `attachment[${i}].filename`, 255),
          contentType: att.contentType !== undefined ? assertString(att.contentType, `attachment[${i}].contentType`, 100) : undefined,
          size: assertNonNegativeInt(att.size, `attachment[${i}].size`),
          content: assertString(att.content, `attachment[${i}].content`, 50000000), // 50MB base64 limit
        };
      });
    }

    return useCases.saveDraft(validated as DraftInput);
  });

  ipcMain.handle('drafts:delete', (_, id) => {
    return useCases.deleteDraft(assertPositiveInt(id, 'id'));
  });

  // ==========================================
  // Contacts
  // ==========================================

  ipcMain.handle('contacts:getRecent', (_, limit) => {
    const l = limit !== undefined ? assertPositiveInt(limit, 'limit') : undefined;
    return useCases.getRecentContacts(l);
  });

  ipcMain.handle('contacts:search', (_, query, limit) => {
    const q = assertString(query, 'query', 100);
    const l = limit !== undefined ? assertPositiveInt(limit, 'limit') : undefined;
    return useCases.searchContacts(q, l);
  });
}
