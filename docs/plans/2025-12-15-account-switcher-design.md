# Account Switcher Design

## Overview

Add a top-level account context switcher to enable separate, isolated views per email account. Users see only one account's data at a time.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | Sidebar bottom | Near Settings, acts as workspace context |
| Unified view | No | Complete isolation per account |
| Visual style | Avatar + email, no chrome | Low cognitive load, high recognition |
| Unread indicators | None | Simplicity over information density |
| Persistence | Yes | Remember last-used account across restarts |

## UI Specification

### Switcher Appearance

```
┌────────────────────┐
│  ⚙️ Settings       │
│  🔵 W  work@co.com │  ← Clickable, no border/chevron
└────────────────────┘
```

- **Avatar:** Colored circle with first letter of email
- **Label:** Email address (truncated if needed)
- **Resting state:** Plain text appearance
- **Hover:** Subtle background highlight (`var(--color-bg-hover)`)
- **No:** border, chevron, drop shadow, button styling

### Dropdown Menu

```
┌─────────────────────┐
│ 🔵 W  work@co.com ✓ │  ← Selected
│ 🟢 P  personal@…    │
│ 🟣 S  side@…        │
└─────────────────────┘
```

- Same avatar + email format
- Checkmark or highlight for active account
- Click to switch, dropdown closes

### Color Assignment

Each account gets a deterministic color based on email hash:

```typescript
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
```

## Data Layer Changes

### 1. Domain Types

Add `accountId` filter to `ListEmailsOptions`:

```typescript
// src/core/domain.ts
export type ListEmailsOptions = {
  accountId?: number;  // NEW: filter by account
  tagId?: number;
  folderId?: number;
  folderPath?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
};
```

### 2. Email Repository

Update `list()` to filter by account:

```typescript
// src/adapters/db/index.ts
async list(options: ListEmailsOptions) {
  let sql = 'SELECT * FROM emails WHERE 1=1';
  const params: any[] = [];

  if (options.accountId) {
    sql += ' AND account_id = ?';
    params.push(options.accountId);
  }
  // ... existing filters
}
```

### 3. Search

Update search to respect account filter:

```typescript
// src/adapters/db/index.ts
async search(query: string, limit?: number, accountId?: number) {
  let sql = `SELECT * FROM emails WHERE (subject LIKE ? OR snippet LIKE ?)`;
  const params = [`%${query}%`, `%${query}%`];

  if (accountId) {
    sql += ' AND account_id = ?';
    params.push(accountId);
  }
  // ...
}
```

### 4. IPC Layer

Pass `accountId` through IPC calls:

```typescript
// src/main/ipc.ts
ipcMain.handle('emails:list', (_, opts) => {
  const validated = assertListOptions(opts);  // Include accountId validation
  return useCases.listEmails(validated);
});

ipcMain.handle('emails:search', (_, query, limit, accountId) => {
  // Validate accountId if provided
  return useCases.searchEmails(query, limit, accountId);
});
```

## UI Layer Changes

### 1. Account Store

Add selected account state with persistence:

```typescript
// src/renderer/stores/index.ts
type AccountStore = {
  accounts: Account[];
  selectedAccountId: number | null;  // NEW

  loadAccounts: () => Promise<void>;
  selectAccount: (id: number) => void;  // NEW
  getSelectedAccount: () => Account | null;  // NEW
};

export const useAccountStore = create<AccountStore>()(
  persist(
    (set, get) => ({
      accounts: [],
      selectedAccountId: null,

      loadAccounts: async () => {
        const accounts = await window.mailApi.accounts.list();
        set({ accounts });

        // Auto-select first account if none selected
        const { selectedAccountId } = get();
        if (!selectedAccountId && accounts.length > 0) {
          set({ selectedAccountId: accounts[0].id });
        }
      },

      selectAccount: (id) => {
        set({ selectedAccountId: id });
      },

      getSelectedAccount: () => {
        const { accounts, selectedAccountId } = get();
        return accounts.find(a => a.id === selectedAccountId) || null;
      },
    }),
    {
      name: 'account-store',
      partialize: (state) => ({ selectedAccountId: state.selectedAccountId }),
    }
  )
);
```

### 2. Email Store Integration

Pass `accountId` to all email queries:

```typescript
// src/renderer/stores/index.ts
loadEmails: async () => {
  const { selectedAccountId } = useAccountStore.getState();
  if (!selectedAccountId) return;

  const { filter } = get();
  const emails = await window.mailApi.emails.list({
    accountId: selectedAccountId,  // NEW
    tagId: filter.tagId,
    folderPath: filter.folderPath,
    // ...
  });
  // ...
}
```

### 3. Sidebar Component

Add AccountSwitcher at bottom:

```typescript
// src/renderer/components/Sidebar.tsx
import { AccountSwitcher } from './AccountSwitcher';

export function Sidebar() {
  return (
    <aside className="sidebar">
      {/* ... existing nav ... */}

      {/* Settings */}
      <div className="px-2 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button /* Settings button */ />
        <AccountSwitcher />
      </div>
    </aside>
  );
}
```

### 4. AccountSwitcher Component

New component:

```typescript
// src/renderer/components/AccountSwitcher.tsx
export function AccountSwitcher() {
  const { accounts, selectedAccountId, selectAccount, getSelectedAccount } = useAccountStore();
  const [isOpen, setIsOpen] = useState(false);
  const selected = getSelectedAccount();

  if (!selected || accounts.length <= 1) return null;  // Hide if single account

  return (
    <div className="relative">
      {/* Trigger - plain text style */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md
                   hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <AccountAvatar email={selected.email} size="sm" />
        <span className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {selected.email}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-1
                        rounded-lg border shadow-lg"
             style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          {accounts.map(account => (
            <button
              key={account.id}
              onClick={() => { selectAccount(account.id); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2
                         hover:bg-[var(--color-bg-hover)]"
            >
              <AccountAvatar email={account.email} size="sm" />
              <span className="text-sm truncate">{account.email}</span>
              {account.id === selectedAccountId && (
                <IconCheck className="w-4 h-4 ml-auto" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountAvatar({ email, size = 'sm' }: { email: string; size?: 'sm' | 'md' }) {
  const color = getAccountColor(email);
  const initial = email[0].toUpperCase();
  const sizeClasses = size === 'sm' ? 'w-5 h-5 text-xs' : 'w-8 h-8 text-sm';

  return (
    <div
      className={`${sizeClasses} rounded-full flex items-center justify-center font-medium text-white`}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  );
}
```

## Affected Views

All views must respect `selectedAccountId`:

| View | Change Required |
|------|-----------------|
| Inbox | Filter by accountId |
| Sent | Filter by accountId |
| Starred | Filter by accountId |
| Archive | Filter by accountId |
| Trash | Filter by accountId |
| Drafts | Filter by accountId |
| AI Sort | Filter by accountId |
| Search | Filter by accountId |
| Sync | Sync selected account only (or all, user choice) |
| Compose | Default "From" to selected account |

## Edge Cases

1. **Account deleted while selected:** Auto-select first remaining account
2. **No accounts:** Show onboarding / "Add Account" prompt
3. **Single account:** Hide switcher entirely (no need)
4. **Account added:** Keep current selection, don't auto-switch

## Out of Scope

- Cross-account unread indicators
- Unified "All Accounts" view
- Keyboard shortcuts for switching
- Account-specific tags (tags remain global)

## Implementation Order

1. Add `accountId` to `ListEmailsOptions` and `EmailRepo.list()`
2. Add `selectedAccountId` to account store with persistence
3. Create `AccountSwitcher` component
4. Wire email store to use selected account
5. Update search to filter by account
6. Update drafts list to filter by account
7. Update sync to target selected account
8. Test all views with multiple accounts
