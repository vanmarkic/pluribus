/**
 * Keyboard Shortcuts Hook
 * 
 * Global keyboard shortcuts for the app.
 */

import { useEffect, useCallback } from 'react';
import { useEmailStore, useUIStore, useAccountStore } from '../stores';

type ShortcutHandler = () => void;

const SHORTCUTS: Record<string, { key: string; ctrl?: boolean; shift?: boolean; description: string }> = {
  compose: { key: 'c', description: 'Compose new email' },
  reply: { key: 'r', description: 'Reply' },
  replyAll: { key: 'r', shift: true, description: 'Reply all' },
  forward: { key: 'f', description: 'Forward' },
  archive: { key: 'e', description: 'Archive' },
  delete: { key: '#', description: 'Delete' },
  star: { key: 's', description: 'Star/unstar' },
  markRead: { key: 'u', description: 'Mark read/unread' },
  search: { key: '/', description: 'Search' },
  refresh: { key: 'r', ctrl: true, description: 'Refresh' },
  nextEmail: { key: 'j or ↓', description: 'Next email' },
  prevEmail: { key: 'k or ↑', description: 'Previous email' },
  openEmail: { key: 'o or Enter', description: 'Open email' },
  escape: { key: 'Escape', description: 'Close/deselect' },
  inbox: { key: 'g', description: 'Go to inbox (press twice)' },
  settings: { key: ',', ctrl: true, description: 'Settings' },
};

export function useKeyboardShortcuts(handlers: {
  onCompose?: ShortcutHandler;
  onReply?: ShortcutHandler;
  onReplyAll?: ShortcutHandler;
  onForward?: ShortcutHandler;
  onSearch?: ShortcutHandler;
  onRefresh?: ShortcutHandler;
}) {
  const { emails, selectedId, selectEmail, toggleStar, archive, markRead, setFilter } = useEmailStore();
  const { setView } = useUIStore();
  const { selectedAccountId } = useAccountStore();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      if (e.key === 'Escape') {
        target.blur();
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // Compose
    if (e.key === 'c' && !ctrl && !shift) {
      e.preventDefault();
      handlers.onCompose?.();
      return;
    }

    // Reply
    if (e.key === 'r' && !ctrl && !shift) {
      e.preventDefault();
      handlers.onReply?.();
      return;
    }

    // Reply All
    if (e.key === 'r' && !ctrl && shift) {
      e.preventDefault();
      handlers.onReplyAll?.();
      return;
    }

    // Forward
    if (e.key === 'f' && !ctrl && !shift) {
      e.preventDefault();
      handlers.onForward?.();
      return;
    }

    // Search
    if (e.key === '/' && !ctrl) {
      e.preventDefault();
      handlers.onSearch?.();
      return;
    }

    // Refresh
    if (e.key === 'r' && ctrl) {
      e.preventDefault();
      handlers.onRefresh?.();
      return;
    }

    // Settings
    if (e.key === ',' && ctrl) {
      e.preventDefault();
      setView('settings');
      return;
    }

    // Star
    if (e.key === 's' && !ctrl && selectedId) {
      e.preventDefault();
      toggleStar(selectedId);
      return;
    }

    // Archive
    if (e.key === 'e' && !ctrl && selectedId) {
      e.preventDefault();
      archive(selectedId);
      return;
    }

    // Mark read/unread
    if (e.key === 'u' && !ctrl && selectedId) {
      e.preventDefault();
      const email = emails.find(em => em.id === selectedId);
      if (email) markRead(selectedId, !email.isRead);
      return;
    }

    // Next email (j or down arrow)
    if ((e.key === 'j' || e.key === 'ArrowDown') && !ctrl) {
      e.preventDefault();
      const currentIndex = emails.findIndex(em => em.id === selectedId);
      if (currentIndex < emails.length - 1) {
        selectEmail(emails[currentIndex + 1].id);
      } else if (currentIndex === -1 && emails.length > 0) {
        // No email selected, select first one
        selectEmail(emails[0].id);
      }
      return;
    }

    // Previous email (k or up arrow)
    if ((e.key === 'k' || e.key === 'ArrowUp') && !ctrl) {
      e.preventDefault();
      const currentIndex = emails.findIndex(em => em.id === selectedId);
      if (currentIndex > 0) {
        selectEmail(emails[currentIndex - 1].id);
      } else if (currentIndex === -1 && emails.length > 0) {
        // No email selected, select first one
        selectEmail(emails[0].id);
      }
      return;
    }

    // Open email (Enter or o)
    if ((e.key === 'Enter' || e.key === 'o') && !ctrl && selectedId) {
      e.preventDefault();
      // Already selected, could open in new window
      return;
    }

    // Escape - deselect
    if (e.key === 'Escape') {
      e.preventDefault();
      selectEmail(null);
      return;
    }

    // Go to inbox
    if (e.key === 'g' && !ctrl) {
      e.preventDefault();
      setView('inbox');
      if (selectedAccountId) {
        setFilter({ folderPath: 'INBOX', tagId: undefined, unreadOnly: false, starredOnly: false, searchQuery: undefined }, selectedAccountId);
      }
      return;
    }
  }, [emails, selectedId, selectEmail, toggleStar, archive, markRead, setView, setFilter, selectedAccountId, handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return SHORTCUTS;
}

/**
 * Keyboard Shortcuts Help Panel
 */
export function KeyboardShortcutsHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  const groups = [
    {
      name: 'Navigation',
      shortcuts: [
        { keys: ['j', '↓'], desc: 'Next email' },
        { keys: ['k', '↑'], desc: 'Previous email' },
        { keys: ['o', '↵'], desc: 'Open email' },
        { keys: ['Esc'], desc: 'Close/deselect' },
        { keys: ['g'], desc: 'Go to inbox' },
        { keys: ['/'], desc: 'Search' },
      ],
    },
    {
      name: 'Actions',
      shortcuts: [
        { keys: ['c'], desc: 'Compose' },
        { keys: ['r'], desc: 'Reply' },
        { keys: ['⇧', 'r'], desc: 'Reply all' },
        { keys: ['f'], desc: 'Forward' },
        { keys: ['s'], desc: 'Star' },
        { keys: ['e'], desc: 'Archive' },
        { keys: ['u'], desc: 'Mark read/unread' },
      ],
    },
    {
      name: 'App',
      shortcuts: [
        { keys: ['⌘', 'r'], desc: 'Refresh' },
        { keys: ['⌘', ','], desc: 'Settings' },
        { keys: ['?'], desc: 'Show shortcuts' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Keyboard Shortcuts</h2>
        
        <div className="grid grid-cols-2 gap-6">
          {groups.map(group => (
            <div key={group.name}>
              <h3 className="text-sm font-medium text-zinc-500 mb-2">{group.name}</h3>
              <div className="space-y-1">
                {group.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">{s.desc}</span>
                    <div className="flex gap-1">
                      {s.keys.map((key, j) => (
                        <kbd
                          key={j}
                          className="px-1.5 py-0.5 bg-zinc-100 rounded text-xs font-mono"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <button
          onClick={onClose}
          className="mt-6 w-full py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg"
        >
          Close
        </button>
      </div>
    </div>
  );
}
