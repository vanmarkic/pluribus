/**
 * Email-body encryption migration use case (#99 follow-up).
 *
 * Walks the email_bodies table and re-saves any plaintext rows through
 * the EmailRepo so they land back encrypted. Safe to run repeatedly:
 * already-encrypted rows are identified by the `v1:` prefix and skipped
 * (see body-cipher.isEncrypted). Runs under the BackgroundTaskManager
 * so the UI can show progress + allow cancellation.
 */

import * as crypto from 'crypto';
import type { Deps, BodyMigrationRepo } from '../ports';

type CountDeps = Pick<Deps, 'bodyMigration'>;
type MigrateDeps = Pick<Deps, 'bodyMigration' | 'emails' | 'backgroundTasks'>;

/**
 * Count the plaintext rows that still need migration. Cheap enough to
 * call on every settings-panel refresh.
 */
export const countPlaintextBodies =
  (deps: CountDeps) =>
  async (): Promise<{ total: number; plaintext: number; encrypted: number }> => {
    return deps.bodyMigration.countByStatus();
  };

/**
 * Start a background migration. Returns the task id immediately; the
 * renderer polls BackgroundTaskManager.getStatus for progress.
 *
 * Only queues rows that still contain plaintext — idempotent across
 * crash/restart, and cheap when everything is already encrypted.
 */
export const migrateEmailBodiesToEncrypted =
  (deps: MigrateDeps) =>
  async (): Promise<{ taskId: string; total: number }> => {
    const rows = await deps.bodyMigration.listPlaintextRows();
    const taskId = crypto.randomUUID();
    deps.backgroundTasks.start(taskId, rows.length, async (onProgress) => {
      for (const row of rows) {
        try {
          // Re-save through the encryption-wrapped EmailRepo. Rows that
          // are already partially encrypted get the mixed text/html
          // rewritten to a consistent ciphertext pair.
          await deps.emails.saveBody(row.emailId, {
            text: row.bodyText ?? '',
            html: row.bodyHtml ?? '',
          });
        } catch (err) {
          // Single row failure shouldn't nuke the rest of the migration —
          // the body stays plaintext, the next run will try again.
          console.warn(`body-migration: failed for email ${row.emailId}:`, err);
        }
        onProgress();
      }
    });

    return { taskId, total: rows.length };
  };

// Re-export for the adapter's convenience.
export type { BodyMigrationRepo };
