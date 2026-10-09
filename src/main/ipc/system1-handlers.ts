/**
 * System 1 (local classifier) IPC handlers.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { checkRateLimit } from './validation';

export function setupSystem1Handlers(container: Container): void {
  const { useCases } = container;

  ipcMain.handle('system1:getStatus', async () => {
    return useCases.getSystem1Status();
  });

  ipcMain.handle('system1:retrain', async () => {
    checkRateLimit('system1:retrain', 5);
    return useCases.trainSystem1();
  });
}
