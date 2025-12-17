/**
 * IPC Handlers - Main Orchestrator
 *
 * Bridges renderer process to use cases.
 * All inputs validated at boundary.
 *
 * This file orchestrates all IPC handler setup by domain.
 */

import { BrowserWindow } from 'electron';
import type { Container } from './container';
import {
  setupEmailHandlers,
  setupSyncHandlers,
  setupClassificationHandlers,
  setupAccountHandlers,
  setupSendHandlers,
  setupConfigHandlers,
  setupContentHandlers,
  setupSystemHandlers,
  setupTriageHandlers,
  getTempFiles,
} from './ipc';

// Re-export temp file tracking for backward compatibility
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
}
