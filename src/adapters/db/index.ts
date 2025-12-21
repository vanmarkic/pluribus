/**
 * SQLite Database Adapter
 *
 * Barrel file that re-exports all repository implementations.
 * Implements all repository ports using better-sqlite3.
 */

// Connection management
export { initDb, getDb, closeDb, checkIntegrity, createDbBackup } from './connection';
export type { InitDbOptions, IntegrityCheckResult } from './connection';

// Repository implementations
export { createEmailRepo } from './email-repo';
export { createAttachmentRepo } from './attachment-repo';
export { createAccountRepo } from './account-repo';
export { createFolderRepo } from './folder-repo';
export { createDraftRepo } from './draft-repo';
export { createContactRepo } from './contact-repo';

// Classification state (separate complex module)
export { createClassificationStateRepo } from './classification-state';

// Awaiting reply
export { createAwaitingRepo } from './awaiting-repo';
