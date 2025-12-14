/**
 * SMTP Adapter
 *
 * Sends emails via nodemailer.
 * Implements MailSender port.
 */

import nodemailer from 'nodemailer';
import type { MailSender, SmtpConfig, EmailDraft, SendResult, SecureStorage } from '../../core/ports';

// Default SMTP configs for common providers
const PROVIDER_CONFIGS: Record<string, SmtpConfig> = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  icloud: { host: 'smtp.mail.me.com', port: 587, secure: false },
  infomaniak: { host: 'mail.infomaniak.com', port: 465, secure: true },
  fastmail: { host: 'smtp.fastmail.com', port: 465, secure: true },
};

export function getSmtpConfig(provider: string): SmtpConfig | null {
  return PROVIDER_CONFIGS[provider.toLowerCase()] || null;
}

export function createMailSender(secrets: SecureStorage): MailSender {
  return {
    async send(accountEmail, smtpConfig, draft) {
      const password = await secrets.getPassword(accountEmail);
      if (!password) throw new Error('No password stored for account');

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: {
          user: accountEmail,
          pass: password,
        },
      });

      const result = await transporter.sendMail({
        from: accountEmail,
        to: draft.to.join(', '),
        cc: draft.cc?.join(', '),
        bcc: draft.bcc?.join(', '),
        subject: draft.subject,
        text: draft.text,
        html: draft.html,
        inReplyTo: draft.inReplyTo,
        references: draft.references?.join(' '),
        attachments: draft.attachments?.map(a => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'base64'),
          contentType: a.contentType,
        })),
      });

      return {
        messageId: result.messageId,
        accepted: Array.isArray(result.accepted)
          ? result.accepted.map(a => typeof a === 'string' ? a : a.address)
          : [],
        rejected: Array.isArray(result.rejected)
          ? result.rejected.map(r => typeof r === 'string' ? r : r.address)
          : [],
      };
    },

    async testConnection(config, email) {
      const password = await secrets.getPassword(email);
      if (!password) {
        return { ok: false, error: 'No password stored for account' };
      }

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: email,
          pass: password,
        },
      });

      try {
        await transporter.verify();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
