/**
 * Quick action buttons that appear on email row hover
 * Archive, Trash, Mark Read/Unread
 */

import { IconArchiveBox, IconDelete, IconEmail, IconEmailFill } from 'obra-icons-react';
import {
  useArchiveEmailMutation,
  useMarkReadMutation,
  useTrashEmailMutation,
} from '../stores';
import { useCurrentListArg } from '../hooks/useCurrentListArg';

interface EmailQuickActionsProps {
  emailId: number;
  isRead: boolean;
  onAction?: () => void;
}

export function EmailQuickActions({ emailId, isRead, onAction }: EmailQuickActionsProps) {
  const listArg = useCurrentListArg();
  const [archive] = useArchiveEmailMutation();
  const [trash] = useTrashEmailMutation();
  const [markRead] = useMarkReadMutation();

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await archive(listArg ? { id: emailId, listArg } : { id: emailId });
    onAction?.();
  };

  const handleTrash = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await trash(listArg ? { id: emailId, listArg } : { id: emailId });
    onAction?.();
  };

  const handleToggleRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await markRead(
      listArg
        ? { id: emailId, isRead: !isRead, listArg }
        : { id: emailId, isRead: !isRead },
    );
    onAction?.();
  };

  return (
    <div
      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={handleArchive}
        className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
        title="Archive (E)"
        aria-label="Archive"
      >
        <IconArchiveBox className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <button
        onClick={handleTrash}
        className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
        title="Delete (Del)"
        aria-label="Delete"
      >
        <IconDelete className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <button
        onClick={handleToggleRead}
        className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
        title={isRead ? 'Mark unread' : 'Mark read'}
        aria-label={isRead ? 'Mark unread' : 'Mark read'}
      >
        {isRead ? (
          <IconEmail className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        ) : (
          <IconEmailFill className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        )}
      </button>
    </div>
  );
}
