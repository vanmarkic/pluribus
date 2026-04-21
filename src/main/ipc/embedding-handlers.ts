/**
 * Embedding / semantic-search IPC handlers (#88).
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { assertPositiveInt } from './validation';

export function setupEmbeddingHandlers(container: Container): void {
  const { useCases } = container;

  ipcMain.handle('embeddings:getStats', async () => {
    return useCases.getEmbeddingIndexStats();
  });

  ipcMain.handle('embeddings:backfill', async (_event, opts?: unknown) => {
    const options = (opts ?? {}) as { limit?: unknown; accountId?: unknown };
    const limit = options.limit === undefined ? 5000 : assertPositiveInt(options.limit, 'limit');
    const accountId = options.accountId === undefined ? undefined : assertPositiveInt(options.accountId, 'accountId');
    return useCases.backfillEmbeddings({ limit: Math.min(limit, 50000), accountId });
  });
}
