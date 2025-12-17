/**
 * Contact Repository
 *
 * Implements ContactRepo port from core/ports.ts using SQLite.
 */

import type { ContactRepo } from '../../core/ports';
import type { RecentContact } from '../../core/domain';
import { getDb, escapeLike } from './connection';
import { mapContact } from './mappers';

export function createContactRepo(): ContactRepo {
  return {
    async getRecent(limit = 20) {
      const rows = getDb().prepare(`
        SELECT address, name, use_count, last_used_at
        FROM recent_contacts
        ORDER BY (use_count * (1.0 / (1 + (julianday('now') - julianday(last_used_at)) / 30))) DESC
        LIMIT ?
      `).all(limit);
      return rows.map(mapContact);
    },

    async search(query, limit = 10) {
      // Escape LIKE special characters to prevent SQL injection
      const escaped = escapeLike(query.toLowerCase());
      const pattern = `%${escaped}%`;
      const rows = getDb().prepare(`
        SELECT address, name, use_count, last_used_at
        FROM recent_contacts
        WHERE lower(address) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\'
        ORDER BY (use_count * (1.0 / (1 + (julianday('now') - julianday(last_used_at)) / 30))) DESC
        LIMIT ?
      `).all(pattern, pattern, limit);
      return rows.map(mapContact);
    },

    async recordUsage(addresses) {
      if (addresses.length === 0) return;

      const stmt = getDb().prepare(`
        INSERT INTO recent_contacts (address, name, use_count, last_used_at)
        VALUES (?, ?, 1, datetime('now'))
        ON CONFLICT(address) DO UPDATE SET
          use_count = use_count + 1,
          last_used_at = datetime('now'),
          name = COALESCE(excluded.name, name)
      `);

      const transaction = getDb().transaction(() => {
        for (const addr of addresses) {
          stmt.run(addr.toLowerCase(), null);
        }
      });
      transaction();
    },
  };
}
