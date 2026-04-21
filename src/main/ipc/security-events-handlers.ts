/**
 * Security-audit-log IPC handlers (#98). Read-only for the renderer —
 * writes happen server-side as security-relevant events occur.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  SecurityEventsListRecentInput,
  SecurityEventsCountByTypeInput,
  parseInput,
} from './schemas';

export function setupSecurityEventsHandlers(container: Container): void {
  const { deps } = container;

  ipcMain.handle('securityEvents:listRecent', async (_event, opts?: unknown) => {
    const parsed = parseInput(SecurityEventsListRecentInput, opts, 'opts') ?? {};
    return deps.securityEvents.listRecent({
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
      ...(parsed.eventType !== undefined ? { eventType: parsed.eventType } : {}),
      ...(parsed.severity !== undefined ? { severity: parsed.severity } : {}),
      ...(parsed.sinceTs ? { sinceTs: new Date(parsed.sinceTs) } : {}),
    });
  });

  ipcMain.handle('securityEvents:countByType', async (_event, sinceIso?: unknown) => {
    const parsed = parseInput(SecurityEventsCountByTypeInput, sinceIso, 'sinceIso');
    if (parsed) {
      return deps.securityEvents.countByType({ sinceTs: new Date(parsed) });
    }
    return deps.securityEvents.countByType();
  });
}
