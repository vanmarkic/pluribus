/**
 * Keyboard navigation hook for EmailList
 *
 * Shortcuts:
 * - ↑/↓: Navigate up/down
 * - Shift+↑/↓: Extend selection up/down
 * - Enter: Open focused email
 * - Delete/Backspace: Trash selected or focused
 * - E: Archive selected or focused
 * - S: Toggle star on focused
 * - R: Reply to focused
 * - Shift+R: Reply all to focused
 * - F: Forward focused
 * - Space: Toggle select on focused
 * - Cmd/Ctrl+A: Select all
 * - Escape: Clear selection
 */

import { useEffect, useCallback, useRef } from 'react';
import {
  useEmailUiStore,
  useUIStore,
  useBulkArchiveMutation,
  useBulkTrashMutation,
  useSetStarredMutation,
} from '../stores';
import { useCurrentListArg } from './useCurrentListArg';
import type { Email } from '../../core/domain';

export function useEmailListKeyboard(emails: Email[]) {
  const focusedId = useEmailUiStore((s) => s.focusedId);
  const selectedIds = useEmailUiStore((s) => s.selectedIds);
  const setFocusedId = useEmailUiStore((s) => s.setFocusedId);
  const toggleSelect = useEmailUiStore((s) => s.toggleSelect);
  const selectRangeAction = useEmailUiStore((s) => s.selectRange);
  const selectAllAction = useEmailUiStore((s) => s.selectAll);
  const clearSelection = useEmailUiStore((s) => s.clearSelection);
  const selectEmail = useEmailUiStore((s) => s.selectEmail);
  const listArg = useCurrentListArg();
  const [setStarred] = useSetStarredMutation();
  const [bulkArchiveMutation] = useBulkArchiveMutation();
  const [bulkTrashMutation] = useBulkTrashMutation();

  const toggleStar = useCallback(
    (id: number) => {
      const target = emails.find((e) => e.id === id);
      if (!target) return;
      const args =
        listArg !== undefined
          ? { id, isStarred: !target.isStarred, listArg }
          : { id, isStarred: !target.isStarred };
      setStarred(args);
    },
    [emails, listArg, setStarred],
  );
  const bulkArchive = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    bulkArchiveMutation(listArg ? { ids, listArg } : { ids });
    clearSelection();
  }, [selectedIds, listArg, bulkArchiveMutation, clearSelection]);
  const bulkTrash = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    bulkTrashMutation(listArg ? { ids, listArg } : { ids });
    clearSelection();
  }, [selectedIds, listArg, bulkTrashMutation, clearSelection]);
  const selectRange = useCallback(
    (fromId: number, toId: number) => {
      selectRangeAction(
        emails.map((e) => e.id),
        fromId,
        toId,
      );
    },
    [emails, selectRangeAction],
  );
  const selectAll = useCallback(
    () => selectAllAction(emails.map((e) => e.id)),
    [emails, selectAllAction],
  );

  const { openCompose } = useUIStore();

  // Track last selected for shift+arrow range selection
  const lastSelectedRef = useRef<number | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      const currentIndex = focusedId ? emails.findIndex((em) => em.id === focusedId) : -1;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = currentIndex < emails.length - 1 ? currentIndex + 1 : currentIndex;
          const nextEmail = emails[nextIndex];
          if (!nextEmail) return;

          if (e.shiftKey && focusedId) {
            // Extend selection
            selectRange(lastSelectedRef.current || focusedId, nextEmail.id);
          }
          setFocusedId(nextEmail.id);
          if (!e.shiftKey) {
            lastSelectedRef.current = nextEmail.id;
          }
          break;
        }

        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          const prevEmail = emails[prevIndex];
          if (!prevEmail) return;

          if (e.shiftKey && focusedId) {
            // Extend selection
            selectRange(lastSelectedRef.current || focusedId, prevEmail.id);
          }
          setFocusedId(prevEmail.id);
          if (!e.shiftKey) {
            lastSelectedRef.current = prevEmail.id;
          }
          break;
        }

        case 'Enter': {
          e.preventDefault();
          if (focusedId) {
            selectEmail(focusedId);
          }
          break;
        }

        case 'Delete':
        case 'Backspace': {
          e.preventDefault();
          if (selectedIds.size > 0) {
            bulkTrash();
          } else if (focusedId) {
            // Trash single focused email
            window.mailApi.emails.trash(focusedId).catch((err) => {
              console.error('Failed to trash email:', err);
            });
            // Move focus to next email
            const nextIndex = Math.min(currentIndex + 1, emails.length - 1);
            if (emails[nextIndex]) {
              setFocusedId(emails[nextIndex].id);
            }
          }
          break;
        }

        case 'e':
        case 'E': {
          if (e.ctrlKey || e.metaKey) return; // Don't interfere with browser shortcuts
          e.preventDefault();
          if (selectedIds.size > 0) {
            bulkArchive();
          } else if (focusedId) {
            window.mailApi.emails.archive(focusedId).catch((err) => {
              console.error('Failed to archive email:', err);
            });
            const nextIndex = Math.min(currentIndex + 1, emails.length - 1);
            if (emails[nextIndex]) {
              setFocusedId(emails[nextIndex].id);
            }
          }
          break;
        }

        case 's':
        case 'S': {
          if (e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (focusedId) {
            toggleStar(focusedId);
          }
          break;
        }

        case 'r':
        case 'R': {
          if (e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (focusedId) {
            openCompose(e.shiftKey ? 'replyAll' : 'reply', focusedId);
          }
          break;
        }

        case 'f':
        case 'F': {
          if (e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (focusedId) {
            openCompose('forward', focusedId);
          }
          break;
        }

        case ' ': {
          e.preventDefault();
          if (focusedId) {
            toggleSelect(focusedId);
            lastSelectedRef.current = focusedId;
          }
          break;
        }

        case 'a':
        case 'A': {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            selectAll();
          }
          break;
        }

        case 'Escape': {
          e.preventDefault();
          clearSelection();
          break;
        }
      }
    },
    [
      emails,
      focusedId,
      selectedIds,
      setFocusedId,
      toggleSelect,
      selectRange,
      selectAll,
      clearSelection,
      selectEmail,
      toggleStar,
      bulkArchive,
      bulkTrash,
      openCompose,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Initialize focus to first email if none focused
  useEffect(() => {
    if (!focusedId && emails.length > 0) {
      const first = emails[0];
      if (first) {
        setFocusedId(first.id);
        lastSelectedRef.current = first.id;
      }
    }
  }, [emails, focusedId, setFocusedId]);

  return { focusedId, selectedIds };
}
