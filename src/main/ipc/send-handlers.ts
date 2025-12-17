/**
 * Send Email IPC Handlers
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertString,
  checkRateLimit,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupSendHandlers(container: Container): void {
  const { useCases, deps } = container;

  // License check helper - throws if license expired and write operations blocked
  const checkLicenseForSend = () => {
    const state = deps.license.getState();
    if (state.isReadOnly) {
      throw new Error('License expired. Please renew to send emails.');
    }
  };

  ipcMain.handle('send:email', async (_, accountId, draft) => {
    checkRateLimit('send:email', 20);
    checkLicenseForSend();
    const id = assertPositiveInt(accountId, 'accountId');

    if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
    const d = draft as Record<string, unknown>;

    if (!Array.isArray(d.to) || d.to.length === 0) throw new Error('Invalid recipients');

    // Validate attachments if present
    let attachments: { filename: string; content: string; contentType?: string }[] | undefined;
    if (Array.isArray(d.attachments)) {
      attachments = (d.attachments as Array<Record<string, unknown>>).map((att, i) => {
        if (!att || typeof att !== 'object') throw new Error(`Invalid attachment at index ${i}`);
        return {
          filename: assertString(att.filename, `attachment[${i}].filename`, 255),
          content: assertString(att.content, `attachment[${i}].content`, 50000000), // ~37MB base64
          contentType: att.contentType ? assertString(att.contentType, `attachment[${i}].contentType`, 100) : undefined,
        };
      });
    }

    const validated = {
      to: (d.to as string[]).map(addr => assertString(addr, 'to', 200)),
      cc: Array.isArray(d.cc) ? (d.cc as string[]).map(addr => assertString(addr, 'cc', 200)) : undefined,
      bcc: Array.isArray(d.bcc) ? (d.bcc as string[]).map(addr => assertString(addr, 'bcc', 200)) : undefined,
      subject: assertString(d.subject, 'subject', 500),
      text: d.text ? assertString(d.text, 'text', 100000) : undefined,
      html: d.html ? assertString(d.html, 'html', 500000) : undefined,
      inReplyTo: d.inReplyTo ? assertString(d.inReplyTo, 'inReplyTo', 500) : undefined,
      references: Array.isArray(d.references) ? (d.references as string[]).map(r => assertString(r, 'reference', 500)) : undefined,
      attachments,
    };

    return useCases.sendEmail(id, validated);
  });

  ipcMain.handle('send:reply', async (_, emailId, body, replyAll) => {
    checkRateLimit('send:reply', 20);
    checkLicenseForSend();
    const id = assertPositiveInt(emailId, 'emailId');

    if (!body || typeof body !== 'object') throw new Error('Invalid body');
    const b = body as Record<string, unknown>;

    const validated = {
      text: b.text ? assertString(b.text, 'text', 100000) : undefined,
      html: b.html ? assertString(b.html, 'html', 500000) : undefined,
    };

    return useCases.replyToEmail(id, validated, Boolean(replyAll));
  });

  ipcMain.handle('send:forward', async (_, emailId, to, body) => {
    checkRateLimit('send:forward', 20);
    checkLicenseForSend();
    const id = assertPositiveInt(emailId, 'emailId');

    if (!Array.isArray(to) || to.length === 0) throw new Error('Invalid recipients');
    const recipients = (to as string[]).map(addr => assertString(addr, 'to', 200));

    if (!body || typeof body !== 'object') throw new Error('Invalid body');
    const b = body as Record<string, unknown>;

    const validated = {
      text: b.text ? assertString(b.text, 'text', 100000) : undefined,
      html: b.html ? assertString(b.html, 'html', 500000) : undefined,
    };

    return useCases.forwardEmail(id, recipients, validated);
  });
}
