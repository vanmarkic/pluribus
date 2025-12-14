# Recent Contacts Autocomplete

## Overview

Add autocomplete to To/Cc/Bcc fields in the compose modal, showing the 20 most-used contacts ranked by a hybrid frequency + recency score.

## Requirements

- **Data source:** Sent emails only (recipients you've written to)
- **Ranking:** Hybrid score combining frequency and recency
- **UI behavior:** Show top 5 on focus, filter as you type
- **Input style:** Comma-separated text (no chips)
- **Scope:** All recipient fields (To, Cc, Bcc)

## Design

### 1. Domain Type (`core/domain.ts`)

```typescript
export type RecentContact = {
  address: string;
  name: string | null;
  score: number;
  lastUsed: Date;
  useCount: number;
};
```

### 2. Port (`core/ports.ts`)

```typescript
export type ContactRepo = {
  getRecent: (limit?: number) => Promise<RecentContact[]>;
  search: (query: string, limit?: number) => Promise<RecentContact[]>;
  recordUsage: (addresses: string[]) => Promise<void>;
};

// Add to Deps:
export type Deps = {
  // ...existing
  contacts: ContactRepo;
};
```

### 3. Use Cases (`core/usecases.ts`)

```typescript
export const getRecentContacts = (deps: Pick<Deps, 'contacts'>) =>
  (limit = 20): Promise<RecentContact[]> =>
    deps.contacts.getRecent(limit);

export const searchContacts = (deps: Pick<Deps, 'contacts'>) =>
  (query: string, limit = 10): Promise<RecentContact[]> =>
    deps.contacts.search(query, limit);

export const recordContactUsage = (deps: Pick<Deps, 'contacts'>) =>
  (addresses: string[]): Promise<void> =>
    deps.contacts.recordUsage(addresses);
```

Add to `createUseCases()`:
```typescript
getRecentContacts: getRecentContacts(deps),
searchContacts: searchContacts(deps),
recordContactUsage: recordContactUsage(deps),
```

### 4. Schema (`adapters/db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS recent_contacts (
  address TEXT PRIMARY KEY,
  name TEXT,
  use_count INTEGER DEFAULT 1,
  last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recent_contacts_score
  ON recent_contacts(use_count, last_used_at);
```

### 5. Adapter (`adapters/db/index.ts`)

```typescript
function mapContact(row: any): RecentContact {
  const lastUsed = new Date(row.last_used_at);
  const daysSince = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
  const recencyMultiplier = 1 / (1 + daysSince / 30); // Decays over ~30 days

  return {
    address: row.address,
    name: row.name,
    useCount: row.use_count,
    lastUsed,
    score: row.use_count * recencyMultiplier,
  };
}

export function createContactRepo(): ContactRepo {
  return {
    async getRecent(limit = 20) {
      const rows = getDb().prepare(`
        SELECT address, name, use_count, last_used_at
        FROM recent_contacts
        ORDER BY (use_count * (1.0 / (1 + (julianday('now') - julianday(last_used_at)) / 30))) DESC
        LIMIT ?
      `).all(limit);
      return rows.map(mapContact);
    },

    async search(query, limit = 10) {
      const pattern = `%${query.toLowerCase()}%`;
      const rows = getDb().prepare(`
        SELECT address, name, use_count, last_used_at
        FROM recent_contacts
        WHERE lower(address) LIKE ? OR lower(name) LIKE ?
        ORDER BY (use_count * (1.0 / (1 + (julianday('now') - julianday(last_used_at)) / 30))) DESC
        LIMIT ?
      `).all(pattern, pattern, limit);
      return rows.map(mapContact);
    },

    async recordUsage(addresses) {
      const stmt = getDb().prepare(`
        INSERT INTO recent_contacts (address, name, use_count, last_used_at)
        VALUES (?, ?, 1, datetime('now'))
        ON CONFLICT(address) DO UPDATE SET
          use_count = use_count + 1,
          last_used_at = datetime('now'),
          name = COALESCE(excluded.name, name)
      `);

      const transaction = getDb().transaction(() => {
        for (const addr of addresses) {
          stmt.run(addr, null);
        }
      });
      transaction();
    },
  };
}
```

### 6. Container Wiring (`main/container.ts`)

```typescript
import { createContactRepo } from '../adapters/db';

const contacts = createContactRepo();

const deps: Deps = {
  // ...existing
  contacts,
};
```

### 7. IPC Handlers (`main/ipc.ts`)

```typescript
ipcMain.handle('contacts:getRecent', (_, limit) => {
  const l = limit ? assertPositiveInt(limit, 'limit') : 20;
  return useCases.getRecentContacts(l);
});

ipcMain.handle('contacts:search', (_, query, limit) => {
  const q = assertString(query, 'query', 200);
  const l = limit ? assertPositiveInt(limit, 'limit') : 10;
  return useCases.searchContacts(q, l);
});
```

### 8. Preload API (`main/preload.ts`)

```typescript
contacts: {
  getRecent: (limit?: number) => ipcRenderer.invoke('contacts:getRecent', limit),
  search: (query: string, limit?: number) => ipcRenderer.invoke('contacts:search', query, limit),
},
```

### 9. Hook: Record Usage on Send

In `sendEmail` use case, call `recordContactUsage` after successful send:

```typescript
export const sendEmail = (deps: Pick<Deps, 'accounts' | 'sender' | 'secrets' | 'contacts'>) =>
  async (accountId: number, draft: EmailDraft): Promise<SendResult> => {
    // ...existing send logic...

    const result = await deps.sender.send(account.email, smtpConfig, draft);

    // Record contact usage for autocomplete
    const allRecipients = [
      ...draft.to,
      ...(draft.cc || []),
      ...(draft.bcc || []),
    ];
    await deps.contacts.recordUsage(allRecipients);

    return result;
  };
```

### 10. UI Component (`renderer/components/ContactAutocomplete.tsx`)

```typescript
type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function ContactAutocomplete({ value, onChange, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<RecentContact[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get current input segment (after last comma)
  const getCurrentSegment = () => {
    const parts = value.split(',');
    return parts[parts.length - 1].trim();
  };

  // Load suggestions on focus or typing
  const loadSuggestions = async () => {
    const segment = getCurrentSegment();
    const results = segment.length > 0
      ? await window.mailApi.contacts.search(segment, 5)
      : await window.mailApi.contacts.getRecent(5);
    setSuggestions(results);
    setHighlightIndex(0);
  };

  // Handle selection
  const selectContact = (contact: RecentContact) => {
    const parts = value.split(',').map(p => p.trim()).filter(Boolean);
    parts.pop(); // Remove current incomplete segment
    parts.push(contact.address);
    onChange(parts.join(', ') + ', ');
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[highlightIndex]) {
        e.preventDefault();
        selectContact(suggestions[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); loadSuggestions(); }}
        onFocus={() => { setShowDropdown(true); loadSuggestions(); }}
        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full outline-none text-sm"
      />

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-10">
          {suggestions.map((contact, i) => (
            <button
              key={contact.address}
              onClick={() => selectContact(contact)}
              className={cn(
                'w-full px-3 py-2 text-left text-sm hover:bg-zinc-50',
                i === highlightIndex && 'bg-zinc-100'
              )}
            >
              <div className="font-medium">{contact.name || contact.address}</div>
              {contact.name && (
                <div className="text-zinc-500 text-xs">{contact.address}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 11. Integration in ComposeModal

Replace the plain input fields with `ContactAutocomplete`:

```typescript
// Before
<input type="text" value={to} onChange={e => setTo(e.target.value)} />

// After
<ContactAutocomplete value={to} onChange={setTo} placeholder="recipient@example.com" />
```

## Implementation Order

1. Add schema (migration)
2. Add domain type
3. Add port
4. Add adapter with mapper
5. Add use cases
6. Wire in container
7. Add IPC handlers
8. Update preload
9. Modify sendEmail to record usage
10. Create ContactAutocomplete component
11. Integrate in ComposeModal

## Testing

```typescript
// Unit test for contact repo
const mockDeps = {
  contacts: {
    getRecent: async () => [
      { address: 'alice@test.com', name: 'Alice', score: 5, lastUsed: new Date(), useCount: 5 }
    ],
    search: async (q: string) => [],
    recordUsage: async () => {},
  }
};

const result = await getRecentContacts(mockDeps)(10);
expect(result).toHaveLength(1);
expect(result[0].address).toBe('alice@test.com');
```
