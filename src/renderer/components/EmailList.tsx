/**
 * Email List Component
 *
 * Displays list of emails with sender, subject, snippet, date.
 * Supports keyboard navigation, multiselect, and quick actions.
 * Uses react-window for virtualization to handle large email lists efficiently.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { IconFavorite } from 'obra-icons-react';
import { useEmailStore, useUIStore, useAccountStore } from '../stores';
import { useEmailListKeyboard } from '../hooks/useEmailListKeyboard';
import { EmailQuickActions } from './EmailQuickActions';
import { BulkActionBar } from './BulkActionBar';
import { formatSender, isRecent } from '../../core/domain';
import type { Email } from '../../core/domain';

// Helper to format date based on recency
const formatDate = (date: Date) => {
  const d = new Date(date);
  if (isRecent(d, 24)) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (isRecent(d, 24 * 7)) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// Sanitize snippet to remove raw HTML, CSS, URLs
const sanitizeSnippet = (snippet: string): string => {
  if (!snippet) return '';

  return snippet
    // Remove CSS-like content (selectors, properties)
    .replace(/[.#]?[\w-]+\s*\{[^}]*\}/g, '')
    // Remove inline styles
    .replace(/style\s*=\s*["'][^"']*["']/gi, '')
    // Remove URLs (http/https)
    .replace(/https?:\/\/[^\s<>"']+/gi, '')
    // Remove template placeholders like %(name)s
    .replace(/%\([^)]+\)[sd]/g, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Remove CSS properties that leaked through
    .replace(/\b(margin|padding|font|color|background|border|width|height|display)\s*:[^;]+;?/gi, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Remove leading/trailing punctuation from cleanup artifacts
    .replace(/^[:\s;{}.]+|[:\s;{}.]+$/g, '')
    .trim();
};

// Data passed to virtualized rows
interface EmailRowData {
  emails: Email[];
  selectedId: number | null;
  focusedId: number | null;
  selectedIds: Set<number>;
  selectEmail: (id: number) => void;
  toggleStar: (id: number) => void;
  toggleSelect: (id: number) => void;
  handleShiftClick: (id: number) => void;
  isSentFolder: boolean;
  onDragStart: (email: Email) => void;
}

// Virtualized email row component
const EmailRow = ({ index, style, data }: ListChildComponentProps) => {
  const {
    emails,
    selectedId,
    focusedId,
    selectedIds,
    selectEmail,
    toggleStar,
    toggleSelect,
    handleShiftClick,
    isSentFolder,
    onDragStart
  } = data as EmailRowData;
  const email = emails[index];

  // In Sent folder, show recipients instead of sender
  const displayName = isSentFolder && email.to.length > 0
    ? `To: ${email.to.join(', ')}`
    : formatSender(email.from);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-email-id', String(email.id));
    e.dataTransfer.setData('text/plain', email.subject || '(no subject)');
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(email);
  };

  // Handle click with modifiers
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click: select range
      handleShiftClick(email.id);
    } else if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl+click: toggle selection
      toggleSelect(email.id);
    } else {
      // Normal click: open email
      selectEmail(email.id);
    }
  };

  const isSelected = selectedId === email.id;
  const isFocused = focusedId === email.id;
  const isMultiSelected = selectedIds.has(email.id);

  // Build class names
  const classNames = [
    'email-item',
    'group', // For hover effects on quick actions
    isSelected && 'selected',
    isFocused && 'focused',
    isMultiSelected && 'multi-selected',
    !email.isRead && 'unread',
  ].filter(Boolean).join(' ');

  return (
    <div style={{ ...style, overflow: 'hidden' }}>
      <div
        onClick={handleClick}
        draggable
        onDragStart={handleDragStart}
        className={classNames}
        style={{ height: '100%', boxSizing: 'border-box', cursor: 'grab' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            selectEmail(email.id);
          }
        }}
      >
        {/* Header row: Checkbox + Sender/Recipient + Star + Date + Quick Actions */}
        <div className="email-item-header">
          <div className="flex items-center gap-2">
            {/* Checkbox for multiselect */}
            <input
              type="checkbox"
              checked={isMultiSelected}
              onChange={(e) => {
                e.stopPropagation();
                toggleSelect(email.id);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 rounded shrink-0"
              aria-label={`Select email from ${displayName}`}
            />
            <span className={`email-item-sender ${!email.isRead ? 'unread' : ''}`}>
              {displayName}
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                toggleStar(email.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleStar(email.id);
                }
              }}
              className={`star-icon ${email.isStarred ? 'starred' : ''}`}
              aria-label={email.isStarred ? 'Remove star' : 'Add star'}
            >
              <IconFavorite className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Quick actions on hover */}
            <EmailQuickActions emailId={email.id} isRead={email.isRead} />
            <span className="email-item-date">{formatDate(email.date)}</span>
          </div>
        </div>

        {/* Subject */}
        <div className={`email-item-subject ${!email.isRead ? 'unread' : ''}`}>
          {!email.isRead && <span className="unread-dot mr-2" />}
          {email.subject || '(no subject)'}
        </div>

        {/* Snippet */}
        <div className="email-item-snippet">
          {sanitizeSnippet(email.snippet)}
        </div>
      </div>
    </div>
  );
};

export function EmailList() {
  const {
    emails,
    selectedId,
    loading,
    loadingMore,
    hasMore,
    selectEmail,
    toggleStar,
    loadMore,
    filter,
    focusedId,
    selectedIds,
    toggleSelect,
    selectRange,
  } = useEmailStore();
  const { view } = useUIStore();
  // useTagStore removed - using folders (Issue #54)
  const { selectedAccountId } = useAccountStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const [listHeight, setListHeight] = useState(600);

  // Track last clicked for shift-click range selection
  const lastClickedRef = useRef<number | null>(null);

  // Use keyboard navigation hook
  useEmailListKeyboard(emails);

  // Note: loadEmails is called by App.tsx when selectedAccountId changes

  // Map view to display title
  const viewTitles: Record<string, string> = {
    inbox: 'Inbox',
    sent: 'Sent',
    starred: 'Starred',
    archive: 'Archive',
    trash: 'Trash',
    drafts: 'Drafts',
    'ai-sort': 'AI Sort',
    // Triage folders
    planning: 'Planning',
    review: 'Review',
    feed: 'Feed',
    social: 'Social',
    promotions: 'Promotions',
    'paper-trail/invoices': 'Invoices',
    'paper-trail/admin': 'Admin',
    'paper-trail/travel': 'Travel',
  };

  // Determine title based on filter state (tagId removed - Issue #54)
  let title = viewTitles[view] || view.charAt(0).toUpperCase() + view.slice(1);
  if (filter.searchQuery) {
    title = 'Search Results';
  }

  // Measure container height for virtualized list
  useEffect(() => {
    if (containerRef.current) {
      const updateHeight = () => {
        if (containerRef.current) {
          const height = containerRef.current.offsetHeight;
          setListHeight(height > 0 ? height : 600);
        }
      };

      updateHeight();
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }
  }, []);

  // Scroll to focused email when focus changes via keyboard navigation
  useEffect(() => {
    if (focusedId && listRef.current && emails.length > 0) {
      const focusedIndex = emails.findIndex(e => e.id === focusedId);
      if (focusedIndex !== -1) {
        listRef.current.scrollToItem(focusedIndex, 'auto');
      }
    }
  }, [focusedId, emails]);

  // Determine if viewing Sent folder to show recipients instead of sender
  const isSentFolder = filter.folderPath?.toLowerCase().includes('sent') ?? false;

  // Track dragged email for visual feedback (future: could show drag preview)
  const [, setDraggedEmail] = useState<Email | null>(null);

  const handleDragStart = (email: Email) => {
    setDraggedEmail(email);
  };

  // Clear drag state when drag ends
  useEffect(() => {
    const handleDragEnd = () => setDraggedEmail(null);
    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);

  // Handle shift-click for range selection
  const handleShiftClick = useCallback((id: number) => {
    if (lastClickedRef.current) {
      selectRange(lastClickedRef.current, id);
    } else {
      toggleSelect(id);
    }
    lastClickedRef.current = id;
  }, [selectRange, toggleSelect]);

  // Update lastClickedRef when toggling select via checkbox
  const handleToggleSelect = useCallback((id: number) => {
    toggleSelect(id);
    lastClickedRef.current = id;
  }, [toggleSelect]);

  // Calculate height adjustment for bulk action bar
  const bulkActionBarHeight = selectedIds.size > 0 ? 48 : 0;

  // Prepare data for virtualized rows
  const itemData: EmailRowData = {
    emails,
    selectedId,
    focusedId,
    selectedIds,
    selectEmail,
    toggleStar,
    toggleSelect: handleToggleSelect,
    handleShiftClick,
    isSentFolder,
    onDragStart: handleDragStart,
  };

  return (
    <div className="email-list">
      {/* Header */}
      <div className="email-list-header">
        <h2 className="email-list-title">{title}</h2>
        <span className="email-list-count">{emails.length} messages</span>
      </div>

      {/* Bulk Action Bar - appears when items are selected */}
      <BulkActionBar />

      {/* Email List */}
      <div className="flex-1 overflow-hidden" ref={containerRef}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            Loading...
          </div>
        ) : emails.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            No emails
          </div>
        ) : (
          <>
            <FixedSizeList
              ref={listRef}
              height={listHeight - (hasMore ? 50 : 0) - bulkActionBarHeight}
              itemCount={emails.length}
              itemSize={120}
              itemData={itemData}
              width="100%"
            >
              {EmailRow}
            </FixedSizeList>

            {hasMore && selectedAccountId && (
              <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  onClick={() => loadMore(selectedAccountId)}
                  disabled={loadingMore}
                  className="w-full py-2 px-4 rounded"
                  style={{
                    backgroundColor: loadingMore ? 'var(--color-background-hover)' : 'var(--color-primary)',
                    color: loadingMore ? 'var(--color-text-muted)' : 'white',
                    cursor: loadingMore ? 'default' : 'pointer',
                  }}
                >
                  {loadingMore ? 'Loading...' : 'Load more emails'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Keyboard shortcuts footer */}
      {emails.length > 0 && (
        <div
          className="px-3 py-1.5 text-xs border-t flex justify-end"
          style={{
            background: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <span>
            <kbd className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>Space</kbd> select
            {' | '}
            <kbd className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>E</kbd> archive
            {' | '}
            <kbd className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>Del</kbd> trash
          </span>
        </div>
      )}
    </div>
  );
}
