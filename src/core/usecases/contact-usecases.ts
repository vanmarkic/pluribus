/**
 * Contact Use Cases
 *
 * All use cases related to contacts:
 * - Getting recent contacts
 * - Searching contacts
 * - Recording contact usage
 */

import type { Deps } from '../ports';
import type { RecentContact } from '../domain';

// ============================================
// Contact Use Cases
// ============================================

export const getRecentContacts = (deps: Pick<Deps, 'contacts'>) =>
  (limit?: number): Promise<RecentContact[]> =>
    deps.contacts.getRecent(limit);

export const searchContacts = (deps: Pick<Deps, 'contacts'>) =>
  (query: string, limit?: number): Promise<RecentContact[]> =>
    deps.contacts.search(query, limit);

export const recordContactUsage = (deps: Pick<Deps, 'contacts'>) =>
  (addresses: string[]): Promise<void> =>
    deps.contacts.recordUsage(addresses);
