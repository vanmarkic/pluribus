/**
 * Body-encryption migration IPC (#99 follow-up).
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';

export function setupBodyMigrationHandlers(container: Container): void {
  const { useCases } = container;

  ipcMain.handle('bodyMigration:getStatus', async () => {
    return useCases.countPlaintextBodies();
  });

  ipcMain.handle('bodyMigration:start', async () => {
    return useCases.migrateEmailBodiesToEncrypted();
  });
}
