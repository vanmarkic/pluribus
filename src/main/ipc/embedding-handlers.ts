/**
 * Embedding / semantic-search IPC handlers (#88).
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { EmbeddingsBackfillInput, parseInput } from './schemas';

export function setupEmbeddingHandlers(container: Container): void {
  const { useCases } = container;

  ipcMain.handle('embeddings:getStats', async () => {
    return useCases.getEmbeddingIndexStats();
  });

  ipcMain.handle('embeddings:backfill', async (_event, opts?: unknown) => {
    const parsed = parseInput(EmbeddingsBackfillInput, opts, 'opts') ?? {};
    return useCases.backfillEmbeddings({
      limit: parsed.limit ?? 5000,
      accountId: parsed.accountId,
    });
  });
}
