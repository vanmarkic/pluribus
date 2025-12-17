/**
 * Database Use Cases
 *
 * All use cases related to database health and maintenance:
 * - Checking database integrity
 * - Creating backups
 */

import type { Deps } from '../ports';

// ============================================
// Database Health & Recovery Use Cases
// ============================================

export const checkDatabaseIntegrity = (deps: Pick<Deps, 'databaseHealth'>) =>
  (full = false): Promise<import('../ports').IntegrityCheckResult> =>
    deps.databaseHealth.checkIntegrity(full);

export const createDatabaseBackup = (deps: Pick<Deps, 'databaseHealth'>) =>
  (): Promise<string> =>
    deps.databaseHealth.createBackup();
