/**
 * Daily digest IPC handlers.
 *
 * The scheduled run is driven from the main process; these handlers cover the
 * manual "run now" / "send test" buttons and the notification-click handshake.
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import { checkRateLimit } from './validation';

export function setupDigestHandlers(container: Container): void {
  const { useCases, digestOpen } = container;

  ipcMain.handle('digest:runNow', async () => {
    checkRateLimit('digest:runNow', 10);
    return useCases.runDailyDigest({ trigger: 'manual' });
  });

  // Always notifies/emails, even with zero items; subject is marked "[test]".
  ipcMain.handle('digest:sendTest', async () => {
    checkRateLimit('digest:sendTest', 5);
    return useCases.runDailyDigest({ trigger: 'test' });
  });

  // True once after a notification click asked to open the Needs-your-reply view.
  ipcMain.handle('digest:consumePendingOpen', () => {
    return digestOpen.consume();
  });
}
