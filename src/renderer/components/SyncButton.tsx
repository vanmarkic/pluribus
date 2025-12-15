/**
 * Sync Button Component
 *
 * Displays sync status and allows triggering/canceling sync.
 * Placed next to AccountSwitcher in the sidebar footer.
 */

import { IconRotate } from 'obra-icons-react';
import { useSyncStore, useAccountStore } from '../stores';

export function SyncButton() {
  const { syncing, syncingAccountId, progress, lastError, startSync, cancelSync } = useSyncStore();
  const { selectedAccountId } = useAccountStore();

  const isSyncingCurrentAccount = syncing && syncingAccountId === selectedAccountId;

  const handleClick = async () => {
    if (!selectedAccountId) return;

    if (isSyncingCurrentAccount) {
      await cancelSync(selectedAccountId);
    } else {
      await startSync(selectedAccountId);
    }
  };

  // Determine tooltip text
  let tooltip = 'Sync account';
  if (isSyncingCurrentAccount) {
    if (progress) {
      tooltip = `Syncing ${progress.folder}: ${progress.current}/${progress.total} - Click to cancel`;
    } else {
      tooltip = 'Syncing... Click to cancel';
    }
  } else if (lastError) {
    tooltip = `Sync failed - Click to retry`;
  }

  return (
    <button
      onClick={handleClick}
      disabled={!selectedAccountId || (syncing && !isSyncingCurrentAccount)}
      className={`p-1.5 rounded-md transition-colors
        ${lastError && !syncing ? 'text-red-500 hover:bg-red-500/10' : ''}
        ${!lastError && !syncing ? 'hover:bg-[var(--color-bg-hover)]' : ''}
        ${syncing ? 'text-[var(--color-accent)]' : ''}
        disabled:opacity-50 disabled:cursor-not-allowed`}
      title={tooltip}
    >
      <IconRotate
        className={`w-4 h-4 ${isSyncingCurrentAccount ? 'animate-spin' : ''}`}
        style={{ color: lastError && !syncing ? undefined : 'var(--color-text-tertiary)' }}
      />
    </button>
  );
}
