/**
 * IPC Handlers - Main Orchestrator
 *
 * Bridges renderer process to use cases.
 * All inputs validated at boundary.
 *
 * This file orchestrates all IPC handler setup by domain.
 */

import { BrowserWindow } from 'electron';
import type { Container } from '../container';
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
import { setupLlmCallsHandlers } from './llm-calls-handlers';
import { setupEmbeddingHandlers } from './embedding-handlers';
import { setupSecurityEventsHandlers } from './security-events-handlers';
import { setupStreamingHandlers } from './streaming-handlers';
import { setupCalibrationHandlers } from './calibration-handlers';
import { setupBodyMigrationHandlers } from './body-migration-handlers';

// Re-export for external use
export { getTempFiles };

/**
 * Register all IPC handlers
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
 */
export function registerIpcHandlers(window: BrowserWindow, container: Container): void {
  setupEmailHandlers(container);
  setupSyncHandlers(container, window);
  setupClassificationHandlers(container, window);
  setupAccountHandlers(container);
  setupSendHandlers(container);
  setupConfigHandlers(container);
  setupContentHandlers(container);
  setupSystemHandlers(container);
  setupTriageHandlers(container);
  setupAwaitingHandlers(container);
  setupLlmCallsHandlers(container);
  setupEmbeddingHandlers(container);
  setupSecurityEventsHandlers(container);
  setupStreamingHandlers(container, window);
  setupCalibrationHandlers(container);
  setupBodyMigrationHandlers(container);
}

// Re-export validation helpers for testing
export * from './validation';
