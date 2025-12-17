/**
 * Folder Repository
 *
 * Implements FolderRepo port from core/ports.ts using SQLite.
 */

import type { FolderRepo } from '../../core/ports';
import type { Folder } from '../../core/domain';
import { getDb } from './connection';
import { mapFolder } from './mappers';

export function createFolderRepo(): FolderRepo {
  return {
    async findById(id) {
      const row = getDb().prepare('SELECT * FROM folders WHERE id = ?').get(id);
      return row ? mapFolder(row) : null;
    },

    async getOrCreate(accountId, path, name, uidValidity) {
      // Poka-yoke: Reject invalid account IDs before they cause FK violations
      if (!accountId || accountId <= 0) {
        throw new Error(`Invalid accountId: ${accountId}. Cannot create folder for non-existent account.`);
      }

      let row = getDb().prepare(`
        SELECT * FROM folders WHERE account_id = ? AND path = ?
      `).get(accountId, path);

      if (!row) {
        const result = getDb().prepare(`
          INSERT INTO folders (account_id, path, name, uid_validity, last_uid)
          VALUES (?, ?, ?, ?, 0)
        `).run(accountId, path, name, uidValidity ?? null);

        return {
          id: result.lastInsertRowid as number,
          accountId, path, name,
          uidValidity: uidValidity ?? null,
          lastUid: 0,
        };
      }

      return mapFolder(row);
    },

    async updateLastUid(folderId, lastUid) {
      getDb().prepare('UPDATE folders SET last_uid = ? WHERE id = ?').run(lastUid, folderId);
    },

    async clear(folderId) {
      getDb().prepare('DELETE FROM emails WHERE folder_id = ?').run(folderId);
      getDb().prepare('UPDATE folders SET last_uid = 0 WHERE id = ?').run(folderId);
    },
  };
}
