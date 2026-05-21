/**
 * Unsubscribe IPC Handlers
 *
 * Provides IPC handlers for email unsubscribe functionality:
 * - unsubscribe:parse - Parse List-Unsubscribe header
 * - unsubscribe:execute - Execute unsubscribe action
 */

import { ipcMain, shell } from 'electron';
import type { Container } from '../container';
import { parseUnsubscribe, executeUnsubscribe } from '../../core/usecases/unsubscribe-usecases';
import type { UnsubscribeInfo } from '../../core/domain';
import { assertPublicHttpUrl } from '../../adapters/net-guard';

/**
 * Runtime-validate the UnsubscribeInfo crossing the IPC boundary. The
 * `https`/`mailto` fields are derived from attacker-controlled email
 * headers, so they must not be trusted as-is.
 */
function assertUnsubscribeInfo(value: unknown): UnsubscribeInfo {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid unsubscribe info');
  }
  const v = value as Record<string, unknown>;
  const mailto = v.mailto ?? null;
  const https = v.https ?? null;
  if (mailto !== null && (typeof mailto !== 'string' || mailto.length > 2000)) {
    throw new Error('Invalid unsubscribe info: mailto');
  }
  if (https !== null && (typeof https !== 'string' || https.length > 2000)) {
    throw new Error('Invalid unsubscribe info: https');
  }
  if (typeof v.oneClick !== 'boolean') {
    throw new Error('Invalid unsubscribe info: oneClick');
  }
  return { mailto, https, oneClick: v.oneClick };
}

export function setupUnsubscribeHandlers(container: Container): void {
  const { deps } = container;

  // Parse List-Unsubscribe header to extract unsubscribe options
  ipcMain.handle('unsubscribe:parse', async (_, listUnsubscribe, listUnsubscribePost) => {
    const header = typeof listUnsubscribe === 'string' ? listUnsubscribe : null;
    const post = typeof listUnsubscribePost === 'string' ? listUnsubscribePost : undefined;
    return parseUnsubscribe(header, post);
  });

  // Execute unsubscribe action (email, one-click POST, or open browser)
  ipcMain.handle('unsubscribe:execute', async (_, rawInfo) => {
    const info = assertUnsubscribeInfo(rawInfo);

    // Create unsubscribe port with actual implementations
    const unsubscribePort = {
      sendUnsubscribeEmail: async (to: string) => {
        // Get first active account to send from
        const accounts = await deps.accounts.findAll();
        const activeAccount = accounts.find((a) => a.isActive);
        if (!activeAccount) {
          throw new Error('No active account to send unsubscribe email');
        }

        // Send minimal unsubscribe email via SMTP
        await deps.sender.send(
          activeAccount.email,
          {
            host: activeAccount.smtpHost,
            port: activeAccount.smtpPort,
            secure: activeAccount.smtpPort === 465,
          },
          {
            to: [to],
            subject: 'Unsubscribe',
            text: 'Unsubscribe',
          },
        );
      },

      postOneClick: async (url: string) => {
        // RFC 8058 one-click unsubscribe via POST. SSRF-guard the URL —
        // it comes straight from an email's List-Unsubscribe header.
        await assertPublicHttpUrl(url);
        const response = await fetch(url, {
          method: 'POST',
          body: 'List-Unsubscribe=One-Click',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!response.ok) {
          throw new Error(`Unsubscribe POST failed: ${response.status}`);
        }
      },

      openExternal: async (url: string) => {
        // Refuse to hand internal URLs to the system browser.
        await assertPublicHttpUrl(url);
        await shell.openExternal(url);
      },
    };

    return executeUnsubscribe({ unsubscribe: unsubscribePort })(info);
  });
}
