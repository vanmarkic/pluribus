/**
 * Email List Component
 *
 * Displays list of emails with sender, subject, snippet, date.
 * Supports keyboard navigation, multiselect, and quick actions.
 * Uses react-window for virtualization to handle large email lists efficiently.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { FixedSizeList, ListChildComponentProps, VariableSizeList } from 'react-window';
import { IconFavorite, IconChevronRight, IconChevronDown, IconLayers } from 'obra-icons-react';
import { skipToken } from '@reduxjs/toolkit/query/react';
import {
  useEmailUiStore,
  useUIStore,
  useAccountStore,
  useThreadStore,
  useListEmailsQuery,
  useSetStarredMutation,
  type ListEmailsArg,
} from '../stores';
import { useEmailListKeyboard } from '../hooks/useEmailListKeyboard';
import { EmailQuickActions } from './EmailQuickActions';
import { BulkActionBar } from './BulkActionBar';
import { formatSender, isRecent } from '../../core/domain';
import type { Email, ThreadSummary } from '../../core/domain';

const PAGE_SIZE = 100;

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

// Group emails by threadId and create thread summaries
const groupEmailsByThread = (emails: Email[]): ThreadSummary[] => {
  const threadMap = new Map<string, Email[]>();
  const noThreadEmails: Email[] = [];

  // Group emails by threadId
  for (const email of emails) {
    if (email.threadId) {
      const existing = threadMap.get(email.threadId) || [];
      existing.push(email);
      threadMap.set(email.threadId, existing);
    } else {
      noThreadEmails.push(email);
    }
  }

  const threads: ThreadSummary[] = [];

  // Create thread summaries for threaded emails
  for (const [threadId, threadEmails] of threadMap) {
    // Sort by date ascending (oldest first)
    threadEmails.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const latestEmail = threadEmails[threadEmails.length - 1];
    const firstEmail = threadEmails[0];
    if (!latestEmail || !firstEmail) continue;
    const unreadCount = threadEmails.filter(e => !e.isRead).length;

    // Collect unique participants
    const participantMap = new Map<string, { address: string; name: string | null }>();
    for (const email of threadEmails) {
      if (!participantMap.has(email.from.address)) {
        participantMap.set(email.from.address, email.from);
      }
    }

    threads.push({
      threadId,
      subject: firstEmail.subject, // Use first email's subject (thread root)
      snippet: sanitizeSnippet(latestEmail.snippet),
      participants: Array.from(participantMap.values()),
      messageCount: threadEmails.length,
      unreadCount,
      latestDate: new Date(latestEmail.date),
      isLatestUnread: !latestEmail.isRead,
      emails: threadEmails,
    });
  }

  // Create single-email "threads" for emails without threadId
  for (const email of noThreadEmails) {
    threads.push({
      threadId: `single-${email.id}`,
      subject: email.subject,
      snippet: sanitizeSnippet(email.snippet),
      participants: [email.from],
      messageCount: 1,
      unreadCount: email.isRead ? 0 : 1,
      latestDate: new Date(email.date),
      isLatestUnread: !email.isRead,
      emails: [email],
    });
  }

  // Sort threads by latest date descending (newest first)
  threads.sort((a, b) => b.latestDate.getTime() - a.latestDate.getTime());

  return threads;
};

// Type for row data in thread view - can be a thread header or an email within a thread
type ThreadViewRow =
  | { type: 'thread'; thread: ThreadSummary; isExpanded: boolean }
  | { type: 'email'; email: Email; threadId: string; isFirst: boolean; isLast: boolean };

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

// Data passed to thread view rows
interface ThreadRowData {
  rows: ThreadViewRow[];
  selectedId: number | null;
  focusedId: number | null;
  focusedThreadId: string | null;
  selectedIds: Set<number>;
  selectEmail: (id: number) => void;
  toggleStar: (id: number) => void;
  toggleSelect: (id: number) => void;
  handleShiftClick: (id: number) => void;
  toggleThread: (threadId: string) => void;
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
  if (!email) return null;

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

// Thread view row component - renders either a thread header or an email within a thread
const ThreadRow = ({ index, style, data }: ListChildComponentProps) => {
  const {
    rows,
    selectedId,
    focusedId,
    focusedThreadId,
    selectedIds,
    selectEmail,
    toggleStar,
    toggleSelect,
    handleShiftClick,
    toggleThread,
    isSentFolder,
    onDragStart
  } = data as ThreadRowData;

  const row = rows[index];
  if (!row) return null;

  if (row.type === 'thread') {
    const { thread, isExpanded } = row;
    const latestEmail = thread.emails[thread.emails.length - 1];
    if (!latestEmail) return null;
    const isFocused = focusedThreadId === thread.threadId;
    const isSelected = selectedId !== null && thread.emails.some(e => e.id === selectedId);

    // In Sent folder, show recipients instead of sender
    const displayName = isSentFolder && thread.participants.length > 0
      ? `To: ${thread.participants.map(p => formatSender(p)).join(', ')}`
      : thread.participants.map(p => formatSender(p)).join(', ');

    const handleClick = (e: React.MouseEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) {
        return;
      }
      // Click on thread opens the latest email
      selectEmail(latestEmail.id);
    };

    const handleExpandClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleThread(thread.threadId);
    };

    // Build class names
    const classNames = [
      'email-item',
      'thread-row',
      'group',
      isSelected && 'selected',
      isFocused && 'focused',
      thread.isLatestUnread && 'unread',
    ].filter(Boolean).join(' ');

    return (
      <div style={{ ...style, overflow: 'hidden' }}>
        <div
          onClick={handleClick}
          className={classNames}
          style={{ height: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              selectEmail(latestEmail.id);
            } else if (e.key === 'ArrowRight' && !isExpanded && thread.messageCount > 1) {
              e.preventDefault();
              toggleThread(thread.threadId);
            } else if (e.key === 'ArrowLeft' && isExpanded) {
              e.preventDefault();
              toggleThread(thread.threadId);
            }
          }}
        >
          {/* Header row: Expand button + Sender/Recipient + Star + Date + Message Count */}
          <div className="email-item-header">
            <div className="flex items-center gap-2">
              {/* Expand/collapse button for threads with multiple messages */}
              {thread.messageCount > 1 ? (
                <button
                  onClick={handleExpandClick}
                  className="thread-expand-btn"
                  aria-label={isExpanded ? 'Collapse thread' : 'Expand thread'}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <IconChevronDown className="w-4 h-4" />
                  ) : (
                    <IconChevronRight className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <span className="w-4" /> /* Spacer for single-message threads */
              )}
              <span className={`email-item-sender ${thread.isLatestUnread ? 'unread' : ''}`}>
                {displayName}
              </span>
              {/* Thread message count badge */}
              {thread.messageCount > 1 && (
                <span className="thread-count-badge">
                  {thread.messageCount}
                </span>
              )}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStar(latestEmail.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleStar(latestEmail.id);
                  }
                }}
                className={`star-icon ${latestEmail.isStarred ? 'starred' : ''}`}
                aria-label={latestEmail.isStarred ? 'Remove star' : 'Add star'}
              >
                <IconFavorite className="w-4 h-4" />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <EmailQuickActions emailId={latestEmail.id} isRead={latestEmail.isRead} />
              <span className="email-item-date">{formatDate(thread.latestDate)}</span>
            </div>
          </div>

          {/* Subject */}
          <div className={`email-item-subject ${thread.isLatestUnread ? 'unread' : ''}`}>
            {thread.isLatestUnread && <span className="unread-dot mr-2" />}
            {thread.subject || '(no subject)'}
          </div>

          {/* Snippet - show latest message snippet */}
          <div className="email-item-snippet">
            {thread.snippet}
          </div>
        </div>
      </div>
    );
  } else {
    // Render email within expanded thread
    const { email, isFirst, isLast } = row;

    const displayName = isSentFolder && email.to.length > 0
      ? `To: ${email.to.join(', ')}`
      : formatSender(email.from);

    const handleDragStart = (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-email-id', String(email.id));
      e.dataTransfer.setData('text/plain', email.subject || '(no subject)');
      e.dataTransfer.effectAllowed = 'move';
      onDragStart(email);
    };

    const handleClick = (e: React.MouseEvent) => {
      if (e.shiftKey) {
        handleShiftClick(email.id);
      } else if (e.metaKey || e.ctrlKey) {
        toggleSelect(email.id);
      } else {
        selectEmail(email.id);
      }
    };

    const isSelected = selectedId === email.id;
    const isFocused = focusedId === email.id;
    const isMultiSelected = selectedIds.has(email.id);

    const classNames = [
      'email-item',
      'thread-email-row',
      'group',
      isSelected && 'selected',
      isFocused && 'focused',
      isMultiSelected && 'multi-selected',
      !email.isRead && 'unread',
      isLast && 'thread-email-last',
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
          {/* Thread connector line */}
          <div className="thread-connector">
            <div className={`thread-line ${isFirst ? 'thread-line-first' : ''} ${isLast ? 'thread-line-last' : ''}`} />
          </div>

          {/* Email content - indented */}
          <div className="thread-email-content">
            <div className="email-item-header">
              <div className="flex items-center gap-2">
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
                <EmailQuickActions emailId={email.id} isRead={email.isRead} />
                <span className="email-item-date">{formatDate(email.date)}</span>
              </div>
            </div>

            {/* Snippet only for thread emails (subject is same as parent) */}
            <div className="email-item-snippet">
              {sanitizeSnippet(email.snippet)}
            </div>
          </div>
        </div>
      </div>
    );
  }
};

export function EmailList() {
  const selectedId = useEmailUiStore((s) => s.selectedId);
  const focusedId = useEmailUiStore((s) => s.focusedId);
  const selectedIds = useEmailUiStore((s) => s.selectedIds);
  const filter = useEmailUiStore((s) => s.filter);
  const selectEmail = useEmailUiStore((s) => s.selectEmail);
  const toggleSelect = useEmailUiStore((s) => s.toggleSelect);
  const selectRange = useEmailUiStore((s) => s.selectRange);
  const { view } = useUIStore();
  const { selectedAccountId } = useAccountStore();
  const { threadView, setThreadView, expandedThreads, toggleThread } = useThreadStore();

  const [offset, setOffset] = useState(0);
  // Reset pagination when account or filter change.
  useEffect(() => {
    setOffset(0);
  }, [selectedAccountId, filter]);

  const baseListArg: ListEmailsArg | null = useMemo(
    () =>
      selectedAccountId
        ? {
            accountId: selectedAccountId,
            ...(filter.folderPath !== undefined ? { folderPath: filter.folderPath } : {}),
            ...(filter.unreadOnly !== undefined ? { unreadOnly: filter.unreadOnly } : {}),
            ...(filter.starredOnly !== undefined ? { starredOnly: filter.starredOnly } : {}),
            ...(filter.searchQuery !== undefined ? { searchQuery: filter.searchQuery } : {}),
          }
        : null,
    [selectedAccountId, filter],
  );

  const queryArg = baseListArg
    ? { ...baseListArg, offset, limit: PAGE_SIZE }
    : skipToken;
  const {
    data: emails = [],
    isLoading: loading,
    isFetching,
  } = useListEmailsQuery(queryArg);
  const loadingMore = isFetching && offset > 0;

  // Heuristic: when the most recent fetch added a full page, assume more.
  const prevLenRef = useRef(0);
  const [hasMore, setHasMore] = useState(true);
  useEffect(() => {
    if (isFetching) return;
    const delta = emails.length - prevLenRef.current;
    if (offset === 0) {
      setHasMore(emails.length >= PAGE_SIZE);
    } else if (delta < PAGE_SIZE) {
      setHasMore(false);
    }
    prevLenRef.current = emails.length;
  }, [emails.length, isFetching, offset]);

  const loadMore = useCallback(() => {
    if (filter.searchQuery) return;
    setOffset((prev) => prev + PAGE_SIZE);
  }, [filter.searchQuery]);

  const [setStarred] = useSetStarredMutation();
  const toggleStar = useCallback(
    (id: number) => {
      const current = emails.find((e) => e.id === id);
      if (!current || !baseListArg) return;
      setStarred({ id, isStarred: !current.isStarred, listArg: baseListArg });
    },
    [emails, baseListArg, setStarred],
  );

  const handleSelectRange = useCallback(
    (fromId: number, toId: number) => {
      selectRange(
        emails.map((e) => e.id),
        fromId,
        toId,
      );
    },
    [emails, selectRange],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const threadListRef = useRef<VariableSizeList>(null);
  const [listHeight, setListHeight] = useState(600);

  // Track focused thread for keyboard navigation in thread view
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);

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

  // Group emails by thread when in thread view
  const threads = useMemo(() => {
    if (!threadView) return [];
    return groupEmailsByThread(emails);
  }, [emails, threadView]);

  // Build flat list of rows for thread view (thread headers + expanded emails)
  const threadRows = useMemo((): ThreadViewRow[] => {
    if (!threadView) return [];

    const rows: ThreadViewRow[] = [];
    for (const thread of threads) {
      const isExpanded = expandedThreads.has(thread.threadId);
      rows.push({ type: 'thread', thread, isExpanded });

      if (isExpanded) {
        thread.emails.forEach((email, idx) => {
          rows.push({
            type: 'email',
            email,
            threadId: thread.threadId,
            isFirst: idx === 0,
            isLast: idx === thread.emails.length - 1,
          });
        });
      }
    }
    return rows;
  }, [threads, expandedThreads, threadView]);

  // Calculate row heights for variable-size list in thread view
  const getItemSize = useCallback((index: number): number => {
    const row = threadRows[index];
    if (!row) return 120;
    // Thread header rows are taller (full email item height)
    // Expanded email rows are shorter (no subject, just sender + snippet)
    return row.type === 'thread' ? 120 : 80;
  }, [threadRows]);

  // Reset thread list cache when rows change
  useEffect(() => {
    if (threadListRef.current) {
      threadListRef.current.resetAfterIndex(0);
    }
  }, [threadRows]);

  // Initialize focused thread when entering thread view
  useEffect(() => {
    if (threadView && threads.length > 0 && !focusedThreadId && threads[0]) {
      setFocusedThreadId(threads[0].threadId);
    }
  }, [threadView, threads, focusedThreadId]);

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
      handleSelectRange(lastClickedRef.current, id);
    } else {
      toggleSelect(id);
    }
    lastClickedRef.current = id;
  }, [handleSelectRange, toggleSelect]);

  // Update lastClickedRef when toggling select via checkbox
  const handleToggleSelect = useCallback((id: number) => {
    toggleSelect(id);
    lastClickedRef.current = id;
  }, [toggleSelect]);

  // Calculate height adjustment for bulk action bar
  const bulkActionBarHeight = selectedIds.size > 0 ? 48 : 0;

  // Prepare data for virtualized rows (flat view)
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

  // Prepare data for thread view rows
  const threadItemData: ThreadRowData = {
    rows: threadRows,
    selectedId,
    focusedId,
    focusedThreadId,
    selectedIds,
    selectEmail,
    toggleStar,
    toggleSelect: handleToggleSelect,
    handleShiftClick,
    toggleThread,
    isSentFolder,
    onDragStart: handleDragStart,
  };

  // Message count display
  const messageCountDisplay = threadView
    ? `${threads.length} conversations`
    : `${emails.length} messages`;

  return (
    <div className="email-list">
      {/* Header */}
      <div className="email-list-header">
        <div className="flex items-center gap-3">
          <h2 className="email-list-title">{title}</h2>
          <span className="email-list-count">{messageCountDisplay}</span>
        </div>
        {/* Thread view toggle */}
        <button
          onClick={() => setThreadView(!threadView)}
          className="thread-view-toggle"
          aria-pressed={threadView}
          title={threadView ? 'Switch to flat view' : 'Switch to thread view'}
        >
          <IconLayers className="w-4 h-4" />
          <span className="text-sm">{threadView ? 'Threads' : 'Flat'}</span>
        </button>
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
        ) : threadView ? (
          /* Thread View */
          <>
            <VariableSizeList
              ref={threadListRef}
              height={listHeight - (hasMore ? 50 : 0) - bulkActionBarHeight}
              itemCount={threadRows.length}
              itemSize={getItemSize}
              itemData={threadItemData}
              width="100%"
            >
              {ThreadRow}
            </VariableSizeList>

            {hasMore && selectedAccountId && (
              <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  onClick={() => loadMore()}
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
        ) : (
          /* Flat View */
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
                  onClick={loadMore}
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
            {threadView && (
              <>
                {' | '}
                <kbd className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>&#8594;</kbd> expand
                {' | '}
                <kbd className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>&#8592;</kbd> collapse
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
