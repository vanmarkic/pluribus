/**
 * Sidebar Component
 *
 * Navigation: Inbox, Starred, Sent, Archive, Trash
 * Tags section with custom tags.
 */

import { useEffect } from 'react';
import {
  IconInbox, IconFavorite, IconSend, IconArchiveBox, IconDelete,
  IconSettings, IconSparkles, IconTag, IconPen
} from 'obra-icons-react';
import { useUIStore, useTagStore, useEmailStore } from '../stores';

export function Sidebar() {
  const { view, setView, openCompose } = useUIStore();
  const { tags, loadTags } = useTagStore();
  const { emails, setFilter, filter } = useEmailStore();

  useEffect(() => {
    loadTags();
  }, []);

  const unreadCount = emails.filter(e => !e.isRead).length;
  const starredCount = emails.filter(e => e.isStarred).length;

  const navItems = [
    { id: 'ai-sort' as const, icon: IconSparkles, label: 'AI Sort', special: true },
    { id: 'inbox' as const, icon: IconInbox, label: 'Inbox', count: unreadCount },
    { id: 'starred' as const, icon: IconFavorite, label: 'Starred', count: starredCount },
    { id: 'sent' as const, icon: IconSend, label: 'Sent' },
    { id: 'archive' as const, icon: IconArchiveBox, label: 'Archive' },
    { id: 'trash' as const, icon: IconDelete, label: 'Trash' },
  ];

  const handleNavClick = (id: string) => {
    setView(id as typeof view);
    // Reset all filters first, then apply view-specific filter
    const baseFilter = { tagId: undefined, folderPath: undefined, unreadOnly: false, starredOnly: false };

    if (id === 'inbox') {
      setFilter({ ...baseFilter, folderPath: 'INBOX' });
    } else if (id === 'sent') {
      // Match any Sent folder variant
      setFilter({ ...baseFilter, folderPath: 'Sent' });
    } else if (id === 'starred') {
      setFilter({ ...baseFilter, starredOnly: true });
    } else if (id === 'archive') {
      const archiveTag = tags.find(t => t.slug === 'archive');
      if (archiveTag) setFilter({ ...baseFilter, tagId: archiveTag.id });
    } else if (id === 'trash') {
      setFilter({ ...baseFilter, folderPath: 'Trash' });
    } else {
      setFilter(baseFilter);
    }
  };

  const handleTagClick = (tagId: number) => {
    setFilter({ tagId });
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
          className="p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Compose (C)"
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
          >
            <item.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span className="sidebar-item-count">{item.count}</span>
            )}
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
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="flex-1 text-left">{tag.name}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Settings */}
      <div className="px-2 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => setView('settings')}
          className={`sidebar-item w-full ${view === 'settings' ? 'active' : ''}`}
        >
          <IconSettings className="w-4 h-4" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
