# Account Switcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add account context switching so each account's emails are viewed in isolation.

**Architecture:** Add `accountId` filter to email queries at domain/adapter/IPC layers. Create `AccountSwitcher` UI component with persisted selection via Zustand.

**Tech Stack:** TypeScript, Zustand (with persist middleware), React, SQLite

---

## Task 1: Add accountId to ListEmailsOptions

**Files:**
- Modify: `src/core/domain.ts:128-136`

**Step 1: Add accountId field**

In `ListEmailsOptions`, add `accountId` as the first optional field:

```typescript
export type ListEmailsOptions = {
  accountId?: number;  // Filter by account
  tagId?: number;
  folderId?: number;
  folderPath?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
};
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no consumers use this field yet)

**Step 3: Commit**

```bash
git add src/core/domain.ts
git commit -m "feat(domain): add accountId to ListEmailsOptions"
```

---

## Task 2: Add accountId filter to EmailRepo.list()

**Files:**
- Modify: `src/adapters/db/index.ts:183-217`
- Test: `src/core/usecases.test.ts`

**Step 1: Write failing test**

Add to `src/core/usecases.test.ts` after the existing `listEmails` tests (around line 262):

```typescript
it('filters by accountId when provided', async () => {
  const emails = createMockEmailRepo({ list: vi.fn().mockResolvedValue([testEmail]) });
  await listEmails({ emails })({ accountId: 5 });

  expect(emails.list).toHaveBeenCalledWith({ accountId: 5 });
});
```

**Step 2: Run test to verify it passes (mock-based)**

Run: `npm test -- --grep "filters by accountId"`
Expected: PASS (mock just records the call)

**Step 3: Update EmailRepo.list() implementation**

In `src/adapters/db/index.ts`, update the `list` function. Add after line 184:

```typescript
async list(options: ListEmailsOptions = {}) {
  const { accountId, tagId, folderId, folderPath, unreadOnly, starredOnly, limit = 100, offset = 0 } = options;

  const conditions: string[] = [];
  const params: any[] = [];
  const joins: string[] = [];

  // NEW: Filter by account
  if (accountId) {
    conditions.push('e.account_id = ?');
    params.push(accountId);
  }

  if (tagId) {
    // ... rest unchanged
```

**Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/adapters/db/index.ts src/core/usecases.test.ts
git commit -m "feat(db): filter emails by accountId"
```

---

## Task 3: Add accountId filter to search

**Files:**
- Modify: `src/core/domain.ts` (add SearchEmailsOptions type)
- Modify: `src/core/ports.ts:17`
- Modify: `src/adapters/db/index.ts:219-243`
- Modify: `src/core/usecases.ts:47-49`
- Modify: `src/main/ipc.ts:93-97`
- Modify: `src/renderer/stores/index.ts:25`

**Step 1: Update EmailRepo.search signature in ports.ts**

```typescript
search: (query: string, limit?: number, accountId?: number) => Promise<Email[]>;
```

**Step 2: Update search implementation in db adapter**

```typescript
async search(query: string, limit = 100, accountId?: number) {
  // ... existing sanitization code ...

  let sql = `
    SELECT e.* FROM emails e
    JOIN emails_fts fts ON e.id = fts.rowid
    WHERE emails_fts MATCH ?
  `;
  const params: any[] = [ftsQuery];

  if (accountId) {
    sql += ' AND e.account_id = ?';
    params.push(accountId);
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(Math.min(limit, 500));

  const rows = getDb().prepare(sql).all(...params);
  return rows.map(mapEmail);
}
```

**Step 3: Update searchEmails use case**

```typescript
export const searchEmails = (deps: Pick<Deps, 'emails'>) =>
  (query: string, limit = 100, accountId?: number): Promise<Email[]> =>
    deps.emails.search(query, limit, accountId);
```

**Step 4: Update IPC handler**

```typescript
ipcMain.handle('emails:search', (_, query, limit, accountId) => {
  const q = assertString(query, 'query', 500);
  const l = assertOptionalPositiveInt(limit, 'limit') ?? 100;
  const a = assertOptionalPositiveInt(accountId, 'accountId');
  return useCases.searchEmails(q, l, a);
});
```

**Step 5: Update window.mailApi type**

```typescript
search: (query: string, limit?: number, accountId?: number) => Promise<Email[]>;
```

**Step 6: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/ports.ts src/adapters/db/index.ts src/core/usecases.ts src/main/ipc.ts src/renderer/stores/index.ts
git commit -m "feat: add accountId filter to email search"
```

---

## Task 4: Add accountId to IPC validation

**Files:**
- Modify: `src/main/ipc.ts:55-71`

**Step 1: Update assertListOptions**

Add accountId validation:

```typescript
function assertListOptions(opts: unknown): Record<string, unknown> {
  if (opts === undefined || opts === null) return {};
  if (typeof opts !== 'object') throw new Error('Invalid options: must be an object');

  const validated: Record<string, unknown> = {};
  const o = opts as Record<string, unknown>;

  if (o.accountId !== undefined) validated.accountId = assertPositiveInt(o.accountId, 'accountId');
  if (o.tagId !== undefined) validated.tagId = assertPositiveInt(o.tagId, 'tagId');
  // ... rest unchanged
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(ipc): validate accountId in list options"
```

---

## Task 5: Add selectedAccountId to AccountStore with persistence

**Files:**
- Modify: `src/renderer/stores/index.ts:402-422`

**Step 1: Add zustand persist import**

At top of file, update import:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
```

**Step 2: Update AccountStore type and implementation**

Replace the AccountStore section:

```typescript
// ============================================
// Account Store
// ============================================

type AccountStore = {
  accounts: Account[];
  selectedAccountId: number | null;
  loading: boolean;

  loadAccounts: () => Promise<void>;
  selectAccount: (id: number) => void;
  getSelectedAccount: () => Account | null;
};

export const useAccountStore = create<AccountStore>()(
  persist(
    (set, get) => ({
      accounts: [],
      selectedAccountId: null,
      loading: false,

      loadAccounts: async () => {
        set({ loading: true });
        const accounts = await window.mailApi.accounts.list();

        // Auto-select first account if none selected or selected no longer exists
        const { selectedAccountId } = get();
        const selectedExists = accounts.some(a => a.id === selectedAccountId);

        if (!selectedAccountId || !selectedExists) {
          set({
            accounts,
            selectedAccountId: accounts.length > 0 ? accounts[0].id : null,
            loading: false
          });
        } else {
          set({ accounts, loading: false });
        }
      },

      selectAccount: (id) => {
        set({ selectedAccountId: id });
        // Trigger email reload when account changes
        useEmailStore.getState().loadEmails();
      },

      getSelectedAccount: () => {
        const { accounts, selectedAccountId } = get();
        return accounts.find(a => a.id === selectedAccountId) || null;
      },
    }),
    {
      name: 'pluribus-account-store',
      partialize: (state) => ({ selectedAccountId: state.selectedAccountId }),
    }
  )
);
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "feat(store): add selectedAccountId with persistence"
```

---

## Task 6: Wire EmailStore to use selectedAccountId

**Files:**
- Modify: `src/renderer/stores/index.ts:179-210`

**Step 1: Update loadEmails to filter by account**

```typescript
loadEmails: async () => {
  const { selectedAccountId } = useAccountStore.getState();

  set({ loading: true, error: null });
  try {
    const { filter } = get();
    let emails: Email[];

    if (filter.searchQuery) {
      emails = await window.mailApi.emails.search(
        filter.searchQuery,
        100,
        selectedAccountId || undefined
      );
    } else {
      emails = await window.mailApi.emails.list({
        accountId: selectedAccountId || undefined,
        tagId: filter.tagId,
        folderPath: filter.folderPath,
        unreadOnly: filter.unreadOnly,
        starredOnly: filter.starredOnly,
        limit: 100,
      });
    }

    // Load tags for all emails in parallel
    const tagsMap: Record<number, AppliedTag[]> = {};
    await Promise.all(
      emails.map(async (email) => {
        const tags = await window.mailApi.tags.getForEmail(email.id);
        tagsMap[email.id] = tags;
      })
    );

    set({ emails, emailTagsMap: tagsMap, loading: false });
  } catch (err) {
    set({ error: String(err), loading: false });
  }
},
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "feat(store): filter emails by selected account"
```

---

## Task 7: Create AccountSwitcher component

**Files:**
- Create: `src/renderer/components/AccountSwitcher.tsx`

**Step 1: Create component file**

```typescript
/**
 * AccountSwitcher Component
 *
 * Displays current account with avatar, opens dropdown to switch.
 * Minimal chrome - plain text appearance until interacted with.
 */

import { useState, useRef, useEffect } from 'react';
import { useAccountStore } from '../stores';

// Deterministic color based on email hash
const ACCOUNT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EF4444', // red
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

function getAccountColor(email: string): string {
  const hash = email.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

function AccountAvatar({ email, size = 'sm' }: { email: string; size?: 'sm' | 'md' }) {
  const color = getAccountColor(email);
  const initial = email[0].toUpperCase();
  const sizeClasses = size === 'sm' ? 'w-5 h-5 text-xs' : 'w-8 h-8 text-sm';

  return (
    <div
      className={`${sizeClasses} rounded-full flex items-center justify-center font-medium text-white shrink-0`}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  );
}

export function AccountSwitcher() {
  const { accounts, selectedAccountId, selectAccount, getSelectedAccount } = useAccountStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = getSelectedAccount();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Hide if no account or single account
  if (!selected || accounts.length <= 1) return null;

  return (
    <div className="relative mt-2" ref={dropdownRef}>
      {/* Trigger - plain text style, no border/chevron */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md
                   hover:bg-[var(--color-bg-hover)] transition-colors text-left"
      >
        <AccountAvatar email={selected.email} size="sm" />
        <span
          className="text-sm truncate"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {selected.email}
        </span>
      </button>

      {/* Dropdown - opens upward */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 py-1
                     rounded-lg border shadow-lg z-50"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)'
          }}
        >
          {accounts.map(account => (
            <button
              key={account.id}
              onClick={() => {
                selectAccount(account.id);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2
                         hover:bg-[var(--color-bg-hover)] text-left"
            >
              <AccountAvatar email={account.email} size="sm" />
              <span
                className="text-sm truncate flex-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {account.email}
              </span>
              {account.id === selectedAccountId && (
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{ color: 'var(--color-accent)' }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/components/AccountSwitcher.tsx
git commit -m "feat(ui): create AccountSwitcher component"
```

---

## Task 8: Add AccountSwitcher to Sidebar

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`

**Step 1: Import AccountSwitcher**

Add import at top:

```typescript
import { AccountSwitcher } from './AccountSwitcher';
```

**Step 2: Add AccountSwitcher below Settings button**

In the bottom section, add `<AccountSwitcher />` after the Settings button:

```typescript
{/* Settings */}
<div className="px-2 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
  <button
    onClick={() => setView('settings')}
    className={`sidebar-item w-full ${view === 'settings' ? 'active' : ''}`}
  >
    <IconSettings className="w-4 h-4" />
    <span>Settings</span>
  </button>
  <AccountSwitcher />
</div>
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat(ui): add AccountSwitcher to sidebar"
```

---

## Task 9: Update SyncStore to sync selected account

**Files:**
- Modify: `src/renderer/stores/index.ts:381-400`

**Step 1: Update startSync to use selected account**

```typescript
startSync: async () => {
  const { selectedAccountId } = useAccountStore.getState();

  set({ syncing: true });
  try {
    if (selectedAccountId) {
      await window.mailApi.sync.start(selectedAccountId);
    } else {
      await window.mailApi.sync.startAll();
    }
    set({ lastSync: new Date() });

    // Reload emails after sync
    useEmailStore.getState().loadEmails();
  } finally {
    set({ syncing: false, progress: null });
  }
},
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "feat(store): sync selected account only"
```

---

## Task 10: Update preload.ts for search signature

**Files:**
- Modify: `src/main/preload.ts`

**Step 1: Find and update emails.search in preload**

Update the search function to pass accountId:

```typescript
search: (query: string, limit?: number, accountId?: number) =>
  ipcRenderer.invoke('emails:search', query, limit, accountId),
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat(preload): pass accountId to search"
```

---

## Task 11: Final integration test

**Step 1: Run full test suite**

Run: `npm test`
Expected: All 148+ tests pass

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Manual verification checklist**

- [ ] App starts without errors
- [ ] With 2+ accounts, switcher appears at sidebar bottom
- [ ] Clicking switcher opens dropdown
- [ ] Selecting different account reloads email list
- [ ] Email counts update per account
- [ ] Search respects selected account
- [ ] Sync syncs selected account only
- [ ] Selection persists after app restart
- [ ] With 1 account, switcher is hidden

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete account switcher implementation

- Add accountId filter to email list and search
- Create AccountSwitcher component with avatar
- Persist selected account across restarts
- Sync respects selected account context"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add accountId to domain type | domain.ts |
| 2 | Add accountId filter to list() | db/index.ts |
| 3 | Add accountId filter to search() | ports.ts, db/index.ts, usecases.ts, ipc.ts |
| 4 | Validate accountId in IPC | ipc.ts |
| 5 | Add selectedAccountId to store | stores/index.ts |
| 6 | Wire EmailStore to account | stores/index.ts |
| 7 | Create AccountSwitcher | AccountSwitcher.tsx |
| 8 | Add to Sidebar | Sidebar.tsx |
| 9 | Update SyncStore | stores/index.ts |
| 10 | Update preload | preload.ts |
| 11 | Integration test | - |
