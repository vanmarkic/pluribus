/**
 * Sidebar Component
 *
 * Sectioned navigation:
 * - Main: Inbox, Sent, Drafts
 * - AI: Classify, Review
 * - Bottom: Settings, License, Account Switcher
 */

import { useEffect, useState } from 'react';
import {
  IconInbox, IconSend, IconDocument,
  IconSettings, IconPen, IconSparkles, IconChecklist
} from 'obra-icons-react';
import { useUIStore, useEmailStore, useAccountStore } from '../stores';
import { AccountSwitcher } from './AccountSwitcher';
import { LicenseStatusBadge } from './LicenseActivation';

export function Sidebar() {
  const { view, setView, openCompose } = useUIStore();
  const { emails, setFilter } = useEmailStore();
  const { selectedAccountId } = useAccountStore();
  const [draftCount, setDraftCount] = useState(0);

  useEffect(() => {
    loadDraftCount();

    const handleDraftsChanged = () => {
      loadDraftCount();
    };
    window.addEventListener('drafts:changed', handleDraftsChanged);

    return () => {
      window.removeEventListener('drafts:changed', handleDraftsChanged);
    };
  }, [selectedAccountId]);

  useEffect(() => {
    if (view === 'drafts') {
      loadDraftCount();
    }
  }, [view, selectedAccountId]);

  const loadDraftCount = async () => {
    try {
      const drafts = await window.mailApi.drafts.list(
        selectedAccountId ? { accountId: selectedAccountId } : undefined
      );
      setDraftCount(drafts.length);
    } catch (err) {
      console.error('Failed to load draft count:', err);
    }
  };

  const unreadCount = emails.filter(e => !e.isRead).length;

  const handleNavClick = (id: string) => {
    setView(id as typeof view);
    if (!selectedAccountId) return;

    const baseFilter = { tagId: undefined, folderPath: undefined, unreadOnly: false, starredOnly: false, searchQuery: undefined };

    if (id === 'inbox') {
      setFilter({ ...baseFilter, folderPath: 'INBOX' }, selectedAccountId);
    } else if (id === 'sent') {
      setFilter({ ...baseFilter, folderPath: 'Sent' }, selectedAccountId);
    } else if (id === 'drafts') {
      setFilter(baseFilter, selectedAccountId);
    } else {
      setFilter(baseFilter, selectedAccountId);
    }
  };

  return (
    <aside className="sidebar">
      {/* App Title */}
      <div className="px-4 py-3 mb-2 shrink-0">
        <span className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Pluribus
        </span>
      </div>

      {/* Compose Button */}
      <div className="px-3 mb-4 shrink-0">
        <button
          onClick={() => openCompose('new')}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
        >
          <IconPen className="w-4 h-4" />
          <span className="font-medium">Compose</span>
        </button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-2 overflow-y-auto overflow-x-hidden min-h-0">
        {/* Main Section: Inbox, Sent, Drafts */}
        <button
          onClick={() => handleNavClick('inbox')}
          className={`sidebar-item w-full ${view === 'inbox' ? 'active' : ''}`}
        >
          <IconInbox className="w-4 h-4" />
          <span className="flex-1 text-left">Inbox</span>
          {unreadCount > 0 && (
            <span className="sidebar-item-count">{unreadCount}</span>
          )}
        </button>

        <button
          onClick={() => handleNavClick('sent')}
          className={`sidebar-item w-full ${view === 'sent' ? 'active' : ''}`}
        >
          <IconSend className="w-4 h-4" />
          <span className="flex-1 text-left">Sent</span>
        </button>

        <button
          onClick={() => handleNavClick('drafts')}
          className={`sidebar-item w-full ${view === 'drafts' ? 'active' : ''}`}
        >
          <IconDocument className="w-4 h-4" />
          <span className="flex-1 text-left">Drafts</span>
          {draftCount > 0 && (
            <span className="sidebar-item-count">{draftCount}</span>
          )}
        </button>

        {/* AI Section - separated by border */}
        <div className="my-3 border-t" style={{ borderColor: 'var(--color-border)' }} />

        <button
          onClick={() => handleNavClick('ai-sort')}
          className={`sidebar-item w-full ${view === 'ai-sort' ? 'active' : ''}`}
          style={view !== 'ai-sort' ? { color: 'var(--color-accent)' } : undefined}
        >
          <IconSparkles className="w-4 h-4" />
          <span className="flex-1 text-left font-medium">Classify</span>
        </button>

        <button
          onClick={() => handleNavClick('review')}
          className={`sidebar-item w-full ${view === 'review' ? 'active' : ''}`}
        >
          <IconChecklist className="w-4 h-4" />
          <span className="flex-1 text-left">Review</span>
        </button>
      </nav>

      {/* Settings Section */}
      <div className="px-2 py-3 border-t shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => setView('settings')}
          className={`sidebar-item w-full ${view === 'settings' ? 'active' : ''}`}
        >
          <IconSettings className="w-4 h-4" />
          <span>Settings</span>
        </button>
        <div className="px-2 py-1">
          <LicenseStatusBadge />
        </div>
        <AccountSwitcher />
      </div>
    </aside>
  );
}
