# Email List Keyboard Navigation & Multiselect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add keyboard navigation, multiselect with range selection, and quick action buttons to the main EmailList component.

**Architecture:** Extend EmailList.tsx with focus-based keyboard handling, selectedIds Set state for multiselect, and hover-reveal action buttons. Add bulk actions to the email store. Follow patterns from TriageReviewView.tsx which already has working keyboard nav and multiselect.

**Tech Stack:** React 18, Zustand, react-window (virtualized list), Tailwind CSS 4

---

## Task 1: Add Multiselect State to Email Store

**Files:**
- Modify: `src/renderer/stores/index.ts:212-252` (EmailStore type and initial state)

**Step 1: Add selectedIds and focusedId to store type**

Add these fields to the `EmailStore` type after line 219:

```typescript
// Multiselect state
selectedIds: Set<number>;
focusedId: number | null;  // Keyboard focus (different from selectedId which opens email)
```

**Step 2: Add multiselect actions to store type**

Add these after line 250 (before the closing brace of EmailStore type):

```typescript
// Multiselect actions
toggleSelect: (id: number) => void;
selectRange: (fromId: number, toId: number) => void;
selectAll: () => void;
clearSelection: () => void;
setFocusedId: (id: number | null) => void;

// Bulk actions
bulkArchive: () => Promise<void>;
bulkTrash: () => Promise<void>;
bulkMarkRead: (isRead: boolean) => Promise<void>;
```

**Step 3: Add initial state values**

Add after line 265 (`error: null,`):

```typescript
selectedIds: new Set(),
focusedId: null,
```

**Step 4: Implement multiselect actions**

Add before the closing `}));` of useEmailStore (around line 507):

```typescript
toggleSelect: (id) => {
  set(state => {
    const newSelected = new Set(state.selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    return { selectedIds: newSelected };
  });
},

selectRange: (fromId, toId) => {
  const { emails } = get();
  const fromIndex = emails.findIndex(e => e.id === fromId);
  const toIndex = emails.findIndex(e => e.id === toId);
  if (fromIndex === -1 || toIndex === -1) return;

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  const rangeIds = emails.slice(start, end + 1).map(e => e.id);

  set(state => ({
    selectedIds: new Set([...state.selectedIds, ...rangeIds]),
  }));
},

selectAll: () => {
  const { emails } = get();
  set({ selectedIds: new Set(emails.map(e => e.id)) });
},

clearSelection: () => {
  set({ selectedIds: new Set() });
},

setFocusedId: (id) => {
  set({ focusedId: id });
},

bulkArchive: async () => {
  const { selectedIds, emails } = get();
  const ids = Array.from(selectedIds);

  // Archive all selected
  await Promise.all(ids.map(id => window.mailApi.emails.archive(id)));

  // Remove from list and clear selection
  set({
    emails: emails.filter(e => !selectedIds.has(e.id)),
    selectedIds: new Set(),
    selectedId: null,
    selectedEmail: null,
  });
},

bulkTrash: async () => {
  const { selectedIds, emails } = get();
  const ids = Array.from(selectedIds);

  // Trash all selected
  await Promise.all(ids.map(id => window.mailApi.emails.trash(id)));

  // Remove from list and clear selection
  set({
    emails: emails.filter(e => !selectedIds.has(e.id)),
    selectedIds: new Set(),
    selectedId: null,
    selectedEmail: null,
  });
},

bulkMarkRead: async (isRead) => {
  const { selectedIds, emails } = get();
  const ids = Array.from(selectedIds);

  // Mark all selected
  await Promise.all(ids.map(id => window.mailApi.emails.markRead(id, isRead)));

  // Update local state
  set({
    emails: emails.map(e => selectedIds.has(e.id) ? { ...e, isRead } : e),
    selectedIds: new Set(),
  });
},
```

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

**Step 6: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "feat(store): add multiselect state and bulk actions to email store"
```

---

## Task 2: Add Keyboard Navigation Hook

**Files:**
- Create: `src/renderer/hooks/useEmailListKeyboard.ts`

**Step 1: Create the keyboard hook**

```typescript
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
import { useEmailStore, useUIStore, useAccountStore } from '../stores';
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
  const { selectedAccountId } = useAccountStore();

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
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/hooks/useEmailListKeyboard.ts
git commit -m "feat(hooks): add keyboard navigation hook for email list"
```

---

## Task 3: Add Quick Action Buttons Component

**Files:**
- Create: `src/renderer/components/EmailQuickActions.tsx`

**Step 1: Create the component**

```typescript
/**
 * Quick action buttons that appear on email row hover
 * Archive, Trash, Mark Read/Unread
 */

import { IconArchive, IconTrash, IconMailOpen, IconMail } from 'obra-icons-react';
import { useEmailStore } from '../stores';

interface EmailQuickActionsProps {
  emailId: number;
  isRead: boolean;
  onAction?: () => void;
}

export function EmailQuickActions({ emailId, isRead, onAction }: EmailQuickActionsProps) {
  const { archive, deleteEmail, markRead } = useEmailStore();

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await archive(emailId);
    onAction?.();
  };

  const handleTrash = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteEmail(emailId);
    onAction?.();
  };

  const handleToggleRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await markRead(emailId, !isRead);
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
        <IconArchive className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <button
        onClick={handleTrash}
        className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
        title="Delete (Del)"
        aria-label="Delete"
      >
        <IconTrash className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <button
        onClick={handleToggleRead}
        className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
        title={isRead ? 'Mark unread' : 'Mark read'}
        aria-label={isRead ? 'Mark unread' : 'Mark read'}
      >
        {isRead ? (
          <IconMail className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        ) : (
          <IconMailOpen className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        )}
      </button>
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/components/EmailQuickActions.tsx
git commit -m "feat(ui): add EmailQuickActions component for hover actions"
```

---

## Task 4: Add Bulk Action Bar Component

**Files:**
- Create: `src/renderer/components/BulkActionBar.tsx`

**Step 1: Create the component**

```typescript
/**
 * Bulk action bar that appears when emails are selected
 * Shows count and actions: Archive, Trash, Mark read/unread
 */

import { IconArchive, IconTrash, IconMailOpen, IconClose } from 'obra-icons-react';
import { useEmailStore } from '../stores';

export function BulkActionBar() {
  const { selectedIds, clearSelection, bulkArchive, bulkTrash, bulkMarkRead } = useEmailStore();

  if (selectedIds.size === 0) return null;

  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-b animate-in slide-in-from-top-2 duration-200"
      style={{
        background: 'var(--color-accent-light)',
        borderColor: 'var(--color-border)'
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={clearSelection}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Clear selection (Esc)"
        >
          <IconClose className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {selectedIds.size} selected
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => bulkMarkRead(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <IconMailOpen className="w-4 h-4" />
          Mark read
        </button>
        <button
          onClick={bulkArchive}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <IconArchive className="w-4 h-4" />
          Archive
        </button>
        <button
          onClick={bulkTrash}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-white transition-colors"
          style={{ background: 'var(--color-danger)' }}
        >
          <IconTrash className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/components/BulkActionBar.tsx
git commit -m "feat(ui): add BulkActionBar component for multi-select actions"
```

---

## Task 5: Update EmailList with Multiselect UI

**Files:**
- Modify: `src/renderer/components/EmailList.tsx`

**Step 1: Update imports and add hook**

Replace lines 1-16 with:

```typescript
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
```

**Step 2: Update EmailRowData interface**

Replace lines 53-61 with:

```typescript
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
```

**Step 3: Update EmailRow component**

Replace lines 64-131 with:

```typescript
// Virtualized email row component
const EmailRow = ({ index, style, data }: ListChildComponentProps) => {
  const {
    emails, selectedId, focusedId, selectedIds,
    selectEmail, toggleStar, toggleSelect, handleShiftClick,
    isSentFolder, onDragStart
  } = data as EmailRowData;
  const email = emails[index];

  const isSelected = selectedIds.has(email.id);
  const isFocused = focusedId === email.id;
  const isViewing = selectedId === email.id;

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

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      handleShiftClick(email.id);
    } else if (e.metaKey || e.ctrlKey) {
      toggleSelect(email.id);
    } else {
      selectEmail(email.id);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSelect(email.id);
  };

  return (
    <div style={{ ...style, overflow: 'hidden' }}>
      <div
        onClick={handleClick}
        draggable
        onDragStart={handleDragStart}
        className={`group email-item ${isViewing ? 'selected' : ''} ${!email.isRead ? 'unread' : ''} ${isFocused ? 'focused' : ''} ${isSelected ? 'multi-selected' : ''}`}
        style={{ height: '100%', boxSizing: 'border-box', cursor: 'grab' }}
        role="button"
        tabIndex={-1}
      >
        {/* Checkbox */}
        <div
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10"
          onClick={handleCheckboxClick}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            className="w-4 h-4 rounded cursor-pointer"
            onClick={e => e.stopPropagation()}
          />
        </div>

        {/* Content with left padding for checkbox */}
        <div className="pl-8">
          {/* Header row: Sender/Recipient + Star + Date + Quick Actions */}
          <div className="email-item-header">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={`email-item-sender truncate ${!email.isRead ? 'unread' : ''}`}>
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
                className={`star-icon shrink-0 ${email.isStarred ? 'starred' : ''}`}
                aria-label={email.isStarred ? 'Remove star' : 'Add star'}
              >
                <IconFavorite className="w-4 h-4" />
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
    </div>
  );
};
```

**Step 4: Update EmailList component**

Replace the EmailList function (starting around line 133) with:

```typescript
export function EmailList() {
  const {
    emails,
    selectedId,
    focusedId,
    selectedIds,
    loading,
    loadingMore,
    hasMore,
    selectEmail,
    toggleStar,
    toggleSelect,
    selectRange,
    loadMore,
    filter,
    setFocusedId,
  } = useEmailStore();
  const { view } = useUIStore();
  const { selectedAccountId } = useAccountStore();

  // Enable keyboard navigation
  useEmailListKeyboard(emails);

  // Track for shift+click range selection
  const lastClickedRef = useRef<number | null>(null);

  const handleShiftClick = useCallback((id: number) => {
    if (lastClickedRef.current) {
      selectRange(lastClickedRef.current, id);
    } else {
      toggleSelect(id);
    }
    lastClickedRef.current = id;
  }, [selectRange, toggleSelect]);

  // Update lastClicked when selecting normally
  const handleSelectEmail = useCallback((id: number) => {
    lastClickedRef.current = id;
    selectEmail(id);
  }, [selectEmail]);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const [listHeight, setListHeight] = useState(600);

  // Map view to display title
  const viewTitles: Record<string, string> = {
    inbox: 'Inbox',
    sent: 'Sent',
    starred: 'Starred',
    archive: 'Archive',
    trash: 'Trash',
    drafts: 'Drafts',
    'ai-sort': 'AI Sort',
    planning: 'Planning',
    review: 'Review',
    feed: 'Feed',
    social: 'Social',
    promotions: 'Promotions',
    'paper-trail/invoices': 'Invoices',
    'paper-trail/admin': 'Admin',
    'paper-trail/travel': 'Travel',
  };

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

  // Scroll to focused email when it changes via keyboard navigation
  useEffect(() => {
    if (focusedId && listRef.current && emails.length > 0) {
      const focusedIndex = emails.findIndex(e => e.id === focusedId);
      if (focusedIndex !== -1) {
        listRef.current.scrollToItem(focusedIndex, 'auto');
      }
    }
  }, [focusedId, emails]);

  // Determine if viewing Sent folder
  const isSentFolder = filter.folderPath?.toLowerCase().includes('sent') ?? false;

  // Track dragged email
  const [, setDraggedEmail] = useState<Email | null>(null);

  const handleDragStart = (email: Email) => {
    setDraggedEmail(email);
  };

  useEffect(() => {
    const handleDragEnd = () => setDraggedEmail(null);
    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);

  // Prepare data for virtualized rows
  const itemData: EmailRowData = {
    emails,
    selectedId,
    focusedId,
    selectedIds,
    selectEmail: handleSelectEmail,
    toggleStar,
    toggleSelect,
    handleShiftClick,
    isSentFolder,
    onDragStart: handleDragStart,
  };

  // Calculate height accounting for bulk action bar
  const bulkBarHeight = selectedIds.size > 0 ? 48 : 0;
  const loadMoreHeight = hasMore ? 50 : 0;

  return (
    <div className="email-list">
      {/* Header */}
      <div className="email-list-header">
        <h2 className="email-list-title">{title}</h2>
        <span className="email-list-count">{emails.length} messages</span>
      </div>

      {/* Bulk Action Bar */}
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
              height={listHeight - bulkBarHeight - loadMoreHeight}
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

      {/* Keyboard shortcut hint */}
      <div
        className="px-3 py-1.5 text-xs border-t flex justify-between"
        style={{
          background: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-tertiary)'
        }}
      >
        <span>↑↓ navigate · Enter open · Space select · E archive · Del trash</span>
        <span>R reply · F forward</span>
      </div>
    </div>
  );
}
```

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer/components/EmailList.tsx
git commit -m "feat(EmailList): integrate keyboard nav, multiselect, and quick actions"
```

---

## Task 6: Add CSS Styles for Focus and Selection States

**Files:**
- Modify: `src/renderer/styles/app.css`

**Step 1: Add styles for focus and multi-select states**

Add after the `.email-item.selected` block (around line 250):

```css
.email-item.focused {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.email-item.multi-selected {
  background: var(--color-accent-light);
}

.email-item.multi-selected.focused {
  background: var(--color-accent-light);
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

/* Ensure checkbox is visible but subtle */
.email-item input[type="checkbox"] {
  accent-color: var(--color-accent);
}

/* Quick actions fade in on hover */
.email-item .group-hover\:opacity-100 {
  transition: opacity 0.15s ease;
}
```

**Step 2: Run dev to verify styles**

Run: `npm run dev`
Expected: App loads, email list shows with new styles

**Step 3: Commit**

```bash
git add src/renderer/styles/app.css
git commit -m "style: add focus and multi-select states for email list"
```

---

## Task 7: Create Hooks Index File

**Files:**
- Create: `src/renderer/hooks/index.ts`

**Step 1: Create barrel export**

```typescript
export { useEmailListKeyboard } from './useEmailListKeyboard';
```

**Step 2: Commit**

```bash
git add src/renderer/hooks/index.ts
git commit -m "chore: add hooks barrel export"
```

---

## Task 8: Manual Testing Checklist

**Test keyboard navigation:**
- [ ] ↑/↓ arrows move focus (blue outline)
- [ ] Enter opens the focused email in viewer
- [ ] Delete/Backspace trashes focused email
- [ ] E archives focused email
- [ ] S toggles star on focused email
- [ ] R opens reply composer
- [ ] Shift+R opens reply-all composer
- [ ] F opens forward composer

**Test selection:**
- [ ] Space toggles selection on focused email
- [ ] Shift+↑/↓ extends selection range
- [ ] Shift+click selects range from last click
- [ ] Cmd/Ctrl+click toggles individual selection
- [ ] Cmd/Ctrl+A selects all
- [ ] Escape clears selection

**Test bulk actions:**
- [ ] Bulk action bar appears when emails selected
- [ ] "Archive" archives all selected
- [ ] "Delete" trashes all selected
- [ ] "Mark read" marks all selected as read
- [ ] Selection count is accurate

**Test quick actions:**
- [ ] Hover reveals Archive/Trash/Read buttons
- [ ] Clicking action works without opening email
- [ ] Actions update list immediately

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Multiselect state in store | `stores/index.ts` |
| 2 | Keyboard navigation hook | `hooks/useEmailListKeyboard.ts` |
| 3 | Quick action buttons | `components/EmailQuickActions.tsx` |
| 4 | Bulk action bar | `components/BulkActionBar.tsx` |
| 5 | EmailList integration | `components/EmailList.tsx` |
| 6 | CSS styles | `styles/app.css` |
| 7 | Hooks index | `hooks/index.ts` |
| 8 | Manual testing | N/A |
