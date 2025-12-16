/**
 * Sidebar Component
 *
 * Navigation: Inbox, Starred, Sent, Archive, Trash
 * Tags section with custom tags.
 */

import { useEffect, useState } from 'react';
import {
  IconInbox, IconFavorite, IconSend, IconArchiveBox, IconDelete,
  IconSettings, IconSparkles, IconTag, IconPen, IconDocument,
  IconClock3, IconChecklist, IconBill, IconBriefcase, IconPlane,
  IconNewspaper, IconNotification, IconMegaphone
} from 'obra-icons-react';
import { useUIStore, useTagStore, useEmailStore, useAccountStore } from '../stores';
import { AccountSwitcher } from './AccountSwitcher';
import { LicenseStatusBadge } from './LicenseActivation';

export function Sidebar() {
  const { view, setView, openCompose } = useUIStore();
  const { tags, loadTags } = useTagStore();
  const { emails, setFilter, filter } = useEmailStore();
  const { selectedAccountId } = useAccountStore();
  const [draftCount, setDraftCount] = useState(0);

  useEffect(() => {
    loadTags();
    loadDraftCount();

    // Listen for draft changes from ComposeModal
    const handleDraftsChanged = () => {
      loadDraftCount();
    };
    window.addEventListener('drafts:changed', handleDraftsChanged);

    return () => {
      window.removeEventListener('drafts:changed', handleDraftsChanged);
    };
  }, [selectedAccountId]);

  // Refresh draft count when the drafts view becomes active or account changes
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
  const starredCount = emails.filter(e => e.isStarred).length;

  const navItems = [
    { id: 'ai-sort' as const, icon: IconSparkles, label: 'AI Sort', special: true },
    { id: 'inbox' as const, icon: IconInbox, label: 'Inbox', count: unreadCount },
    { id: 'starred' as const, icon: IconFavorite, label: 'Starred', count: starredCount },
    { id: 'sent' as const, icon: IconSend, label: 'Sent' },
    { id: 'drafts' as const, icon: IconDocument, label: 'Drafts', count: draftCount },
    { id: 'archive' as const, icon: IconArchiveBox, label: 'Archive' },
    { id: 'trash' as const, icon: IconDelete, label: 'Trash' },
  ];

  // Triage folders
  const triageFolders = [
    { id: 'planning' as const, icon: IconClock3, label: 'Planning' },
    { id: 'review' as const, icon: IconChecklist, label: 'Review' },
    { id: 'feed' as const, icon: IconNewspaper, label: 'Feed' },
    { id: 'social' as const, icon: IconNotification, label: 'Social' },
    { id: 'promotions' as const, icon: IconMegaphone, label: 'Promotions' },
  ];

  // Paper Trail subfolders
  const paperTrailFolders = [
    { id: 'paper-trail/invoices' as const, icon: IconBill, label: 'Invoices' },
    { id: 'paper-trail/admin' as const, icon: IconBriefcase, label: 'Admin' },
    { id: 'paper-trail/travel' as const, icon: IconPlane, label: 'Travel' },
  ];

  // Map view IDs to folder paths for triage folders
  const triageFolderMap: Record<string, string> = {
    'planning': 'Planning',
    'review': 'Review',
    'feed': 'Feed',
    'social': 'Social',
    'promotions': 'Promotions',
    'paper-trail/invoices': 'Paper-Trail/Invoices',
    'paper-trail/admin': 'Paper-Trail/Admin',
    'paper-trail/travel': 'Paper-Trail/Travel',
  };

  const handleNavClick = (id: string) => {
    setView(id as typeof view);
    if (!selectedAccountId) return;

    // Reset all filters first, then apply view-specific filter
    const baseFilter = { tagId: undefined, folderPath: undefined, unreadOnly: false, starredOnly: false, searchQuery: undefined };

    if (id === 'inbox') {
      setFilter({ ...baseFilter, folderPath: 'INBOX' }, selectedAccountId);
    } else if (id === 'sent') {
      // Match any Sent folder variant
      setFilter({ ...baseFilter, folderPath: 'Sent' }, selectedAccountId);
    } else if (id === 'drafts') {
      // Drafts view - handled by DraftsList component, no email filter needed
      setFilter(baseFilter, selectedAccountId);
    } else if (id === 'starred') {
      setFilter({ ...baseFilter, starredOnly: true }, selectedAccountId);
    } else if (id === 'archive') {
      const archiveTag = tags.find(t => t.slug === 'archive');
      if (archiveTag) setFilter({ ...baseFilter, tagId: archiveTag.id }, selectedAccountId);
    } else if (id === 'trash') {
      setFilter({ ...baseFilter, folderPath: 'Trash' }, selectedAccountId);
    } else if (triageFolderMap[id]) {
      // Triage folders - filter by folder path
      setFilter({ ...baseFilter, folderPath: triageFolderMap[id] }, selectedAccountId);
    } else {
      setFilter(baseFilter, selectedAccountId);
    }
  };

  const handleTagClick = (tagId: number) => {
    if (!selectedAccountId) return;
    // Reset all filters first, then apply tag filter
    const baseFilter = { tagId: undefined, folderPath: undefined, unreadOnly: false, starredOnly: false, searchQuery: undefined };
    setFilter({ ...baseFilter, tagId }, selectedAccountId);
  };

  const userTags = tags.filter(t => !t.isSystem);

  return (
    <aside className="sidebar">
      {/* App Title + Compose */}
      <div className="px-4 py-3 mb-2 flex items-center justify-between">
        <span className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Mail
        </span>
        <button
          onClick={() => openCompose('new')}
          className="p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-[-2px]"
          title="Compose (C)"
          aria-label="Compose new email"
        >
          <IconPen className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => handleNavClick(item.id)}
            className={`sidebar-item w-full ${view === item.id ? 'active' : ''}`}
            aria-label={`${item.label}${item.count ? ` (${item.count} items)` : ''}`}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <item.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span className="sidebar-item-count">{item.count}</span>
            )}
          </button>
        ))}

        {/* Triage Section */}
        <div className="sidebar-section flex items-center gap-1 mt-4">
          <IconSparkles className="w-3 h-3" />
          <span>Triage</span>
        </div>

        {triageFolders.map(item => (
          <button
            key={item.id}
            onClick={() => handleNavClick(item.id)}
            className={`sidebar-item w-full ${view === item.id ? 'active' : ''}`}
            aria-label={item.label}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <item.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        ))}

        {/* Paper Trail Section */}
        <div className="sidebar-section flex items-center gap-1 mt-4">
          <IconBill className="w-3 h-3" />
          <span>Paper Trail</span>
        </div>

        {paperTrailFolders.map(item => (
          <button
            key={item.id}
            onClick={() => handleNavClick(item.id)}
            className={`sidebar-item w-full ${view === item.id ? 'active' : ''}`}
            aria-label={item.label}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <item.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        ))}

        {/* Tags Section */}
        {userTags.length > 0 && (
          <>
            <div className="sidebar-section flex items-center gap-1 mt-4">
              <IconTag className="w-3 h-3" />
              <span>Tags</span>
            </div>

            {userTags.map(tag => (
              <button
                key={tag.id}
                onClick={() => handleTagClick(tag.id)}
                className={`sidebar-item w-full ${filter.tagId === tag.id ? 'active' : ''}`}
                aria-label={`Filter by tag: ${tag.name}`}
                aria-pressed={filter.tagId === tag.id}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                  aria-hidden="true"
                />
                <span className="flex-1 text-left">{tag.name}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Settings, License & Account Switcher */}
      <div className="px-2 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => setView('settings')}
          className={`sidebar-item w-full ${view === 'settings' ? 'active' : ''}`}
          aria-label="Settings"
          aria-current={view === 'settings' ? 'page' : undefined}
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
