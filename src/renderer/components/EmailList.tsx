/**
 * Email List Component
 *
 * Displays list of emails with sender, subject, snippet, date, and tags.
 * Matches reference design with clean layout.
 * Uses react-window for virtualization to handle large email lists efficiently.
 */

import { useRef, useEffect, useState } from 'react';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { IconFavorite } from 'obra-icons-react';
// useTagStore removed - using folders for organization (Issue #54)
import { useEmailStore, useUIStore, useAccountStore } from '../stores';
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
  selectEmail: (id: number) => void;
  toggleStar: (id: number) => void;
  isSentFolder: boolean;
}

// Virtualized email row component
const EmailRow = ({ index, style, data }: ListChildComponentProps) => {
  const { emails, selectedId, selectEmail, toggleStar, isSentFolder } = data;
  const email = emails[index];

  // In Sent folder, show recipients instead of sender
  const displayName = isSentFolder && email.to.length > 0
    ? `To: ${email.to.join(', ')}`
    : formatSender(email.from);

  return (
    <div style={{ ...style, overflow: 'hidden' }}>
      <button
        onClick={() => selectEmail(email.id)}
        className={`email-item ${selectedId === email.id ? 'selected' : ''} ${!email.isRead ? 'unread' : ''}`}
        style={{ height: '100%', boxSizing: 'border-box' }}
      >
        {/* Header row: Sender/Recipient + Star + Date */}
        <div className="email-item-header">
          <div className="flex items-center gap-2">
            <span className={`email-item-sender ${!email.isRead ? 'unread' : ''}`}>
              {displayName}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleStar(email.id);
              }}
              className={`star-icon ${email.isStarred ? 'starred' : ''}`}
            >
              <IconFavorite className="w-4 h-4" />
            </button>
          </div>
          <span className="email-item-date">{formatDate(email.date)}</span>
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
      </button>
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
  } = useEmailStore();
  const { view } = useUIStore();
  // useTagStore removed - using folders (Issue #54)
  const { selectedAccountId } = useAccountStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const [listHeight, setListHeight] = useState(600);

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

  // Scroll to selected email when selection changes via keyboard navigation
  useEffect(() => {
    if (selectedId && listRef.current && emails.length > 0) {
      const selectedIndex = emails.findIndex(e => e.id === selectedId);
      if (selectedIndex !== -1) {
        listRef.current.scrollToItem(selectedIndex, 'auto');
      }
    }
  }, [selectedId, emails]);

  // Determine if viewing Sent folder to show recipients instead of sender
  const isSentFolder = filter.folderPath?.toLowerCase().includes('sent') ?? false;

  // Prepare data for virtualized rows
  const itemData: EmailRowData = {
    emails,
    selectedId,
    selectEmail,
    toggleStar,
    isSentFolder,
  };

  return (
    <div className="email-list">
      {/* Header */}
      <div className="email-list-header">
        <h2 className="email-list-title">{title}</h2>
        <span className="email-list-count">{emails.length} messages</span>
      </div>

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
              height={listHeight - (hasMore ? 50 : 0)}
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
    </div>
  );
}
