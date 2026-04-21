/**
 * LLM Calls IPC Handlers (#94 cost dashboard)
 *
 * Reads from the `llm_calls` table populated by the classifier observability
 * sink wired in container.ts.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { assertPositiveInt } from './validation';

export function setupLlmCallsHandlers(container: Container): void {
  const { deps } = container;

  ipcMain.handle('llmCalls:getStats', async () => {
    return deps.llmCalls.getStats();
  });

  ipcMain.handle('llmCalls:listRecent', async (_event, limit?: unknown) => {
    const n = limit === undefined ? 50 : assertPositiveInt(limit, 'limit');
    return deps.llmCalls.listRecent(Math.min(n, 200));
  });

  ipcMain.handle('llmCalls:getDailyCost', async (_event, days?: unknown) => {
    const d = days === undefined ? 30 : assertPositiveInt(days, 'days');
    return deps.llmCalls.getDailyCost(Math.min(d, 365));
  });
}
