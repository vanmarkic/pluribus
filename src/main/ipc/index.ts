/**
 * IPC Handlers - Exports all setup functions
 *
 * This file consolidates all IPC handler setup functions
 * organized by domain vertical slices.
 */

export { setupEmailHandlers, getTempFiles } from './email-handlers';
export { setupSyncHandlers } from './sync-handlers';
export { setupClassificationHandlers } from './classification-handlers';
export { setupAccountHandlers } from './account-handlers';
export { setupSendHandlers } from './send-handlers';
export { setupConfigHandlers } from './config-handlers';
export { setupContentHandlers } from './content-handlers';
export { setupSystemHandlers } from './system-handlers';
export { setupTriageHandlers } from './triage-handlers';

// Re-export validation helpers for testing
export * from './validation';
