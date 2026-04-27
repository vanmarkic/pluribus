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
        const base = {
          filename: assertString(att.filename, `attachment[${i}].filename`, 255),
          content: assertString(att.content, `attachment[${i}].content`, 50000000),
        };
        return att.contentType
          ? { ...base, contentType: assertString(att.contentType, `attachment[${i}].contentType`, 100) }
          : base;
      });
    }

    // exactOptionalPropertyTypes: build the validated object with only
    // the keys that actually have values — `{ foo: undefined }` is
    // rejected by the port type where the field is truly optional.
    const validated: import('../../core/ports').EmailDraft = {
      to: (d.to as string[]).map(addr => assertString(addr, 'to', 200)),
      subject: assertString(d.subject, 'subject', 500),
      ...(Array.isArray(d.cc)
        ? { cc: (d.cc as string[]).map(addr => assertString(addr, 'cc', 200)) }
        : {}),
      ...(Array.isArray(d.bcc)
        ? { bcc: (d.bcc as string[]).map(addr => assertString(addr, 'bcc', 200)) }
        : {}),
      ...(d.text ? { text: assertString(d.text, 'text', 100000) } : {}),
      ...(d.html ? { html: assertString(d.html, 'html', 500000) } : {}),
      ...(d.inReplyTo ? { inReplyTo: assertString(d.inReplyTo, 'inReplyTo', 500) } : {}),
      ...(Array.isArray(d.references)
        ? { references: (d.references as string[]).map(r => assertString(r, 'reference', 500)) }
        : {}),
      ...(attachments ? { attachments } : {}),
    };

    return useCases.sendEmail(id, validated);
  });

  ipcMain.handle('send:reply', async (_, emailId, body, replyAll) => {
    checkRateLimit('send:reply', 20);
    checkLicenseForSend();
    const id = assertPositiveInt(emailId, 'emailId');

    if (!body || typeof body !== 'object') throw new Error('Invalid body');
    const b = body as Record<string, unknown>;

    const validated: { text?: string; html?: string } = {
      ...(b.text ? { text: assertString(b.text, 'text', 100000) } : {}),
      ...(b.html ? { html: assertString(b.html, 'html', 500000) } : {}),
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

    const validated: { text?: string; html?: string } = {
      ...(b.text ? { text: assertString(b.text, 'text', 100000) } : {}),
      ...(b.html ? { html: assertString(b.html, 'html', 500000) } : {}),
    };

    return useCases.forwardEmail(id, recipients, validated);
  });
}
