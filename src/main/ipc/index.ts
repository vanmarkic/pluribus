/**
 * IPC Handlers - Main Orchestrator
 *
 * Bridges renderer process to use cases.
 * All inputs validated at boundary.
 *
 * This file orchestrates all IPC handler setup by domain.
 */

import type { Container } from '../container';
import type { WindowGetter } from '../window-manager';
import { setupEmailHandlers, getTempFiles } from './email-handlers';
import { setupSyncHandlers } from './sync-handlers';
import { setupClassificationHandlers } from './classification-handlers';
import { setupAccountHandlers } from './account-handlers';
import { setupSendHandlers } from './send-handlers';
import { setupConfigHandlers } from './config-handlers';
import { setupContentHandlers } from './content-handlers';
import { setupSystemHandlers } from './system-handlers';
import { setupTriageHandlers } from './triage-handlers';
import { setupAwaitingHandlers } from './awaiting-handlers';
import { setupThreadHandlers } from './thread-handlers';
import { setupUnsubscribeHandlers } from './unsubscribe-handlers';
import { setupSendQueueHandlers } from './send-queue-handlers';
import { setupLlmCallsHandlers } from './llm-calls-handlers';
import { setupEmbeddingHandlers } from './embedding-handlers';
import { setupSecurityEventsHandlers } from './security-events-handlers';
import { setupStreamingHandlers } from './streaming-handlers';
import { setupCalibrationHandlers } from './calibration-handlers';
import { setupBodyMigrationHandlers } from './body-migration-handlers';
import { setupRepliesHandlers } from './replies-handlers';
import { setupDigestHandlers } from './digest-handlers';
import { setupSystem1Handlers } from './system1-handlers';

// Re-export for external use
export { getTempFiles };

let ipcHandlersRegistered = false;

/**
 * Register all IPC handlers (once per process)
 *
 * `getWindow` is late-bound: handlers that push events to the renderer ask
 * for the current window each time, because the window can be closed and
 * re-created while the app keeps running (macOS).
 *
 * Organized by domain vertical slices:
 * - Email & Attachments
 * - Sync
 * - Classification (LLM + AI Sort)
 * - Accounts, Credentials & Security
 * - Send Email
 * - Config
 * - Content (Images, Drafts, Contacts)
 * - System (Database, Ollama, License)
 * - Triage
 * - Awaiting Reply
 * - Threads
 * - Unsubscribe
 * - Send Queue (undo send)
 * - Needs-your-reply, Daily digest, System 1
 */
export function registerIpcHandlers(getWindow: WindowGetter, container: Container): void {
  // ipcMain.handle throws on a duplicate channel, so registering twice would
  // leave a half-registered, hard-to-diagnose state. Fail loudly and early.
  // The flag is set first: even a failed first attempt leaves some channels
  // registered, and a retry could only trip over them.
  if (ipcHandlersRegistered) {
    throw new Error(
      'IPC handlers are already registered: registerIpcHandlers must be called once per process',
    );
  }
  ipcHandlersRegistered = true;

  setupEmailHandlers(container);
  setupSyncHandlers(container, getWindow);
  setupClassificationHandlers(container, getWindow);
  setupAccountHandlers(container);
  setupSendHandlers(container);
  setupConfigHandlers(container);
  setupContentHandlers(container);
  setupSystemHandlers(container);
  setupTriageHandlers(container);
  setupAwaitingHandlers(container);
  setupThreadHandlers(container);
  setupUnsubscribeHandlers(container);
  setupSendQueueHandlers(container.sendQueue);
  setupLlmCallsHandlers(container);
  setupEmbeddingHandlers(container);
  setupSecurityEventsHandlers(container);
  setupStreamingHandlers(container, getWindow);
  setupCalibrationHandlers(container);
  setupBodyMigrationHandlers(container);
  setupRepliesHandlers(container);
  setupDigestHandlers(container);
  setupSystem1Handlers(container);
}

// Re-export validation helpers for testing
export * from './validation';
