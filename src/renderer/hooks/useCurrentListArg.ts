/**
 * Resolves the current `listEmails` query arg for the active account + filter.
 *
 * Used by mutation callers so they can pass `listArg` to the mutation —
 * that is the cache key the optimistic update needs to patch.
 */

import { useAccountStore, useEmailUiStore } from '../stores';
import type { ListEmailsArg } from '../stores';

export function useCurrentListArg(): ListEmailsArg | undefined {
  const accountId = useAccountStore((s) => s.selectedAccountId);
  const filter = useEmailUiStore((s) => s.filter);
  if (!accountId) return undefined;
  const arg: ListEmailsArg = { accountId };
  if (filter.folderPath !== undefined) arg.folderPath = filter.folderPath;
  if (filter.unreadOnly !== undefined) arg.unreadOnly = filter.unreadOnly;
  if (filter.starredOnly !== undefined) arg.starredOnly = filter.starredOnly;
  if (filter.searchQuery !== undefined) arg.searchQuery = filter.searchQuery;
  return arg;
}
