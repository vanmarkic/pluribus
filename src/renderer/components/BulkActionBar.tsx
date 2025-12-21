/**
 * Bulk action bar that appears when emails are selected
 * Shows count and actions: Archive, Trash, Mark read/unread
 */

import { IconArchiveBox, IconDelete, IconEmail, IconClose } from 'obra-icons-react';
import { useEmailStore } from '../stores';

export function BulkActionBar() {
  const { selectedIds, clearSelection, bulkArchive, bulkTrash, bulkMarkRead } = useEmailStore();

  if (selectedIds.size === 0) return null;

  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-b animate-in slide-in-from-top-2 duration-200"
      style={{
        background: 'var(--color-accent-light)',
        borderColor: 'var(--color-border)'
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={clearSelection}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Clear selection (Esc)"
        >
          <IconClose className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {selectedIds.size} selected
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => bulkMarkRead(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <IconEmail className="w-4 h-4" />
          Mark read
        </button>
        <button
          onClick={bulkArchive}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <IconArchiveBox className="w-4 h-4" />
          Archive
        </button>
        <button
          onClick={bulkTrash}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-white transition-colors"
          style={{ background: 'var(--color-danger)' }}
        >
          <IconDelete className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
