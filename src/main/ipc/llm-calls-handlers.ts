/**
 * LLM Calls IPC Handlers (#94 cost dashboard)
 *
 * Reads from the `llm_calls` table populated by the classifier observability
 * sink wired in container.ts.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Container } from '../container';
import { parseInput } from './schemas';

// Legacy positional-arg style: listRecent takes `limit` as a scalar, not an
// options object. Kept backwards-compatible by accepting either shape.
const LimitArg = z.union([z.undefined(), z.number().int().positive().max(500)]);
const DaysArg = z.union([z.undefined(), z.number().int().positive().max(365)]);

export function setupLlmCallsHandlers(container: Container): void {
  const { deps } = container;

  ipcMain.handle('llmCalls:getStats', async () => {
    return deps.llmCalls.getStats();
  });

  ipcMain.handle('llmCalls:listRecent', async (_event, limit?: unknown) => {
    const parsed = parseInput(LimitArg, limit, 'limit');
    return deps.llmCalls.listRecent(Math.min(parsed ?? 50, 200));
  });

  ipcMain.handle('llmCalls:getDailyCost', async (_event, days?: unknown) => {
    const parsed = parseInput(DaysArg, days, 'days');
    return deps.llmCalls.getDailyCost(parsed ?? 30);
  });
}
