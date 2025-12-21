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
import { useEmailStore, useUIStore } from '../stores';
import type { Email } from '../../core/domain';

export function useEmailListKeyboard(emails: Email[]) {
  const {
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
  } = useEmailStore();

  const { openCompose } = useUIStore();

  // Track last selected for shift+arrow range selection
  const lastSelectedRef = useRef<number | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if in input/textarea
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    ) {
      return;
    }

    const currentIndex = focusedId
      ? emails.findIndex(em => em.id === focusedId)
      : -1;

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
          window.mailApi.emails.trash(focusedId);
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
          window.mailApi.emails.archive(focusedId);
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
  }, [
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
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Initialize focus to first email if none focused
  useEffect(() => {
    if (!focusedId && emails.length > 0) {
      setFocusedId(emails[0].id);
      lastSelectedRef.current = emails[0].id;
    }
  }, [emails, focusedId, setFocusedId]);

  return { focusedId, selectedIds };
}
