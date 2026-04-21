/**
 * Security-audit-log IPC handlers (#98). Read-only for the renderer —
 * writes happen server-side as security-relevant events occur.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { assertPositiveInt, assertString } from './validation';

const ALLOWED_SEVERITY = new Set(['info', 'warn', 'alert']);

export function setupSecurityEventsHandlers(container: Container): void {
  const { deps } = container;

  ipcMain.handle('securityEvents:listRecent', async (_event, opts?: unknown) => {
    const options = (opts ?? {}) as {
      limit?: unknown;
      eventType?: unknown;
      severity?: unknown;
      sinceTs?: unknown;
    };

    const normalized: Parameters<typeof deps.securityEvents.listRecent>[0] = {};
    if (options.limit !== undefined) {
      normalized.limit = Math.min(assertPositiveInt(options.limit, 'limit'), 1000);
    }
    if (options.eventType !== undefined) {
      normalized.eventType = assertString(options.eventType, 'eventType', 100);
    }
    if (options.severity !== undefined) {
      const sev = assertString(options.severity, 'severity', 10);
      if (!ALLOWED_SEVERITY.has(sev)) throw new Error(`Invalid severity: ${sev}`);
      normalized.severity = sev as 'info' | 'warn' | 'alert';
    }
    if (typeof options.sinceTs === 'string') {
      const parsed = new Date(options.sinceTs);
      if (!Number.isNaN(parsed.getTime())) normalized.sinceTs = parsed;
    }

    return deps.securityEvents.listRecent(normalized);
  });

  ipcMain.handle('securityEvents:countByType', async (_event, sinceIso?: unknown) => {
    if (typeof sinceIso === 'string') {
      const parsed = new Date(sinceIso);
      if (!Number.isNaN(parsed.getTime())) {
        return deps.securityEvents.countByType({ sinceTs: parsed });
      }
    }
    return deps.securityEvents.countByType();
  });
}
