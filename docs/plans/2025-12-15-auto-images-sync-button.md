# Auto-Download Images & Sync Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-download images when opening emails (setting: 'auto') and add a sync button with cancel support next to the account switcher.

**Architecture:** Extend existing ports/use cases pattern. Add 'auto' to RemoteImagesSetting type, create cancelSync use case with AbortController in IMAP adapter, add SyncButton component next to AccountSwitcher.

**Tech Stack:** TypeScript, React, Zustand, ImapFlow (AbortController for cancel)

---

## Task 1: Add 'auto' to RemoteImagesSetting Type

**Files:**
- Modify: `src/core/ports.ts:264`

**Step 1: Write the failing test**

Create test file: `src/core/__tests__/ports.test.ts`

```typescript
import type { RemoteImagesSetting } from '../ports';

describe('RemoteImagesSetting', () => {
  it('should accept auto as a valid value', () => {
    const setting: RemoteImagesSetting = 'auto';
    expect(['block', 'allow', 'auto']).toContain(setting);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: Type error - '"auto"' is not assignable to type 'RemoteImagesSetting'

**Step 3: Update the type**

In `src/core/ports.ts`, change line 264:

```typescript
export type RemoteImagesSetting = 'block' | 'allow' | 'auto';
```

**Step 4: Run test to verify it passes**

Run: `npm run typecheck`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/core/ports.ts src/core/__tests__/ports.test.ts
git commit -m "feat: add 'auto' option to RemoteImagesSetting type"
```

---

## Task 2: Add autoLoadImagesForEmail Use Case

**Files:**
- Modify: `src/core/usecases.ts` (after line 1082, in Remote Images section)

**Step 1: Write the failing test**

Create test file: `src/core/__tests__/usecases.autoload.test.ts`

```typescript
import { autoLoadImagesForEmail } from '../usecases';
import type { Deps } from '../ports';

describe('autoLoadImagesForEmail', () => {
  const mockCachedImages = [
    { url: 'https://example.com/img.png', localPath: 'file:///cache/img.png' },
  ];

  const createMockDeps = (overrides: Partial<Deps> = {}) => ({
    config: {
      getRemoteImagesSetting: () => 'auto' as const,
      getLLMConfig: () => ({} as any),
      setRemoteImagesSetting: () => {},
    },
    imageCache: {
      hasLoadedImages: async () => false,
      getCachedImages: async () => mockCachedImages,
      cacheImages: async () => mockCachedImages,
      markImagesLoaded: async () => {},
      clearCache: async () => {},
      clearAllCache: async () => {},
    },
    ...overrides,
  }) as unknown as Pick<Deps, 'config' | 'imageCache'>;

  it('returns empty array when setting is block', async () => {
    const deps = createMockDeps({
      config: {
        getRemoteImagesSetting: () => 'block' as const,
        getLLMConfig: () => ({} as any),
        setRemoteImagesSetting: () => {},
      },
    });

    const result = await autoLoadImagesForEmail(deps)(123, ['https://example.com/img.png']);
    expect(result).toEqual([]);
  });

  it('returns cached images when already loaded', async () => {
    const deps = createMockDeps({
      imageCache: {
        hasLoadedImages: async () => true,
        getCachedImages: async () => mockCachedImages,
        cacheImages: async () => mockCachedImages,
        markImagesLoaded: async () => {},
        clearCache: async () => {},
        clearAllCache: async () => {},
      },
    });

    const result = await autoLoadImagesForEmail(deps)(123, ['https://example.com/img.png']);
    expect(result).toEqual(mockCachedImages);
  });

  it('fetches and caches images when not loaded and setting is auto', async () => {
    const cacheImagesSpy = jest.fn().mockResolvedValue(mockCachedImages);
    const markLoadedSpy = jest.fn().mockResolvedValue(undefined);

    const deps = createMockDeps({
      imageCache: {
        hasLoadedImages: async () => false,
        getCachedImages: async () => [],
        cacheImages: cacheImagesSpy,
        markImagesLoaded: markLoadedSpy,
        clearCache: async () => {},
        clearAllCache: async () => {},
      },
    });

    const urls = ['https://example.com/img.png'];
    const result = await autoLoadImagesForEmail(deps)(123, urls);

    expect(cacheImagesSpy).toHaveBeenCalledWith(123, urls);
    expect(markLoadedSpy).toHaveBeenCalledWith(123);
    expect(result).toEqual(mockCachedImages);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/core/__tests__/usecases.autoload.test.ts`
Expected: FAIL - autoLoadImagesForEmail is not exported

**Step 3: Implement the use case**

In `src/core/usecases.ts`, add after line 1082 (after `clearAllImageCache`):

```typescript
export const autoLoadImagesForEmail = (deps: Pick<Deps, 'config' | 'imageCache'>) =>
  async (emailId: number, blockedUrls: string[]): Promise<CachedImage[]> => {
    // Check setting - block means no auto-load
    const setting = deps.config.getRemoteImagesSetting();
    if (setting === 'block') {
      return [];
    }

    // Check if already loaded
    const alreadyLoaded = await deps.imageCache.hasLoadedImages(emailId);
    if (alreadyLoaded) {
      return deps.imageCache.getCachedImages(emailId);
    }

    // For 'auto' or 'allow', fetch and cache
    if (blockedUrls.length === 0) {
      return [];
    }

    const cached = await deps.imageCache.cacheImages(emailId, blockedUrls);
    await deps.imageCache.markImagesLoaded(emailId);
    return cached;
  };
```

**Step 4: Add to createUseCases factory**

In `src/core/usecases.ts`, add to the `createUseCases` return object (around line 1210):

```typescript
    // Remote Images
    loadRemoteImages: loadRemoteImages(deps),
    hasLoadedRemoteImages: hasLoadedRemoteImages(deps),
    getRemoteImagesSetting: getRemoteImagesSetting(deps),
    setRemoteImagesSetting: setRemoteImagesSetting(deps),
    clearImageCache: clearImageCache(deps),
    clearAllImageCache: clearAllImageCache(deps),
    autoLoadImagesForEmail: autoLoadImagesForEmail(deps),  // ADD THIS LINE
```

**Step 5: Run test to verify it passes**

Run: `npx jest src/core/__tests__/usecases.autoload.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/usecases.ts src/core/__tests__/usecases.autoload.test.ts
git commit -m "feat: add autoLoadImagesForEmail use case"
```

---

## Task 3: Add IPC Handler for images:autoLoad

**Files:**
- Modify: `src/main/ipc.ts` (after line 800, in Remote Images section)

**Step 1: Add the IPC handler**

In `src/main/ipc.ts`, add after line 800 (after `images:clearAllCache`):

```typescript
  ipcMain.handle('images:autoLoad', async (_, emailId, urls) => {
    const id = assertPositiveInt(emailId, 'emailId');
    if (!Array.isArray(urls)) throw new Error('Invalid urls: must be an array');
    const validatedUrls = urls.map((url, i) => assertString(url, `urls[${i}]`, 2000));
    return useCases.autoLoadImagesForEmail(id, validatedUrls);
  });
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: add images:autoLoad IPC handler"
```

---

## Task 4: Update IPC Handler to Accept 'auto' Setting

**Files:**
- Modify: `src/main/ipc.ts:777-781`

**Step 1: Update the validation**

In `src/main/ipc.ts`, change lines 777-781:

```typescript
  ipcMain.handle('images:setSetting', (_, setting) => {
    const validSettings = ['block', 'allow', 'auto'];
    const s = assertString(setting, 'setting', 10);
    if (!validSettings.includes(s)) throw new Error('Invalid setting');
    return useCases.setRemoteImagesSetting(s as 'block' | 'allow' | 'auto');
  });
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: allow 'auto' value in images:setSetting IPC handler"
```

---

## Task 5: Expose autoLoad in Preload API

**Files:**
- Modify: `src/main/preload.ts:143-151`

**Step 1: Update the images API**

In `src/main/preload.ts`, update the images object (lines 143-151):

```typescript
  images: {
    getSetting: () => ipcRenderer.invoke('images:getSetting') as Promise<'block' | 'allow' | 'auto'>,
    setSetting: (setting: 'block' | 'allow' | 'auto') => ipcRenderer.invoke('images:setSetting', setting),
    hasLoaded: (emailId: number) => ipcRenderer.invoke('images:hasLoaded', emailId) as Promise<boolean>,
    load: (emailId: number, urls: string[]) =>
      ipcRenderer.invoke('images:load', emailId, urls) as Promise<{ url: string; localPath: string }[]>,
    autoLoad: (emailId: number, urls: string[]) =>
      ipcRenderer.invoke('images:autoLoad', emailId, urls) as Promise<{ url: string; localPath: string }[]>,
    clearCache: (emailId: number) => ipcRenderer.invoke('images:clearCache', emailId),
    clearAllCache: () => ipcRenderer.invoke('images:clearAllCache') as Promise<void>,
  },
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: expose images.autoLoad in preload API"
```

---

## Task 6: Update Store Types for 'auto' Setting

**Files:**
- Modify: `src/renderer/stores/index.ts:95-102`

**Step 1: Update the images type in Window interface**

In `src/renderer/stores/index.ts`, update the images type (lines 95-102):

```typescript
      images: {
        getSetting: () => Promise<'block' | 'allow' | 'auto'>;
        setSetting: (setting: 'block' | 'allow' | 'auto') => Promise<void>;
        hasLoaded: (emailId: number) => Promise<boolean>;
        load: (emailId: number, urls: string[]) => Promise<{ url: string; localPath: string }[]>;
        autoLoad: (emailId: number, urls: string[]) => Promise<{ url: string; localPath: string }[]>;
        clearCache: (emailId: number) => Promise<void>;
        clearAllCache: () => Promise<void>;
      };
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "feat: update store types for 'auto' image setting"
```

---

## Task 7: Update EmailViewer for Auto-Load Images

**Files:**
- Modify: `src/renderer/components/EmailViewer.tsx`

**Step 1: Update the checkImagesLoaded effect**

In `src/renderer/components/EmailViewer.tsx`, replace the useEffect at lines 156-179 with:

```typescript
  // Check if images should be auto-loaded for this email
  useEffect(() => {
    if (!email) return;

    const checkAndAutoLoad = async () => {
      try {
        const setting = await window.mailApi.images.getSetting();

        if (setting === 'block') {
          setImagesLoaded(false);
          return;
        }

        if (setting === 'allow') {
          // 'allow' loads directly from remote - no caching
          setImagesLoaded(true);
          return;
        }

        // 'auto' - check if already loaded, otherwise will auto-load
        const loaded = await window.mailApi.images.hasLoaded(email.id);
        setImagesLoaded(loaded);
      } catch (err) {
        console.error('Failed to check images loaded status:', err);
      }
    };

    checkAndAutoLoad();
  }, [email?.id]);
```

**Step 2: Add auto-load effect when body is ready**

Add a new useEffect after the existing image loading effect (after line 212):

```typescript
  // Auto-load images when setting is 'auto' and we have blocked URLs
  useEffect(() => {
    if (!email || imagesLoaded || blockedUrls.length === 0) return;

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) return;

      try {
        const setting = await window.mailApi.images.getSetting();
        if (setting !== 'auto') return;

        setLoadingImages(true);
        const cached = await window.mailApi.images.autoLoad(email.id, blockedUrls);

        if (cancelled || !bodyContainerRef.current) return;

        // Create URL mapping and update DOM
        const urlMap = new Map(cached.map(c => [c.url, c.localPath]));
        const blockedImages = bodyContainerRef.current.querySelectorAll('img[data-original-src]');
        blockedImages.forEach((img) => {
          const originalSrc = img.getAttribute('data-original-src');
          if (originalSrc && urlMap.has(originalSrc)) {
            img.setAttribute('src', urlMap.get(originalSrc)!);
            img.removeAttribute('data-original-src');
            img.setAttribute('alt', '');
            img.classList.remove('blocked-image');
          }
        });

        setImagesLoaded(true);
      } catch (err) {
        console.error('Failed to auto-load images:', err);
      } finally {
        if (!cancelled) setLoadingImages(false);
      }
    }, 200); // 200ms debounce for rapid email switching

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [email?.id, blockedUrls, imagesLoaded]);
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/renderer/components/EmailViewer.tsx
git commit -m "feat: auto-load images when setting is 'auto'"
```

---

## Task 8: Add cancelSync to MailSync Port

**Files:**
- Modify: `src/core/ports.ts:106-115`

**Step 1: Update the MailSync type**

In `src/core/ports.ts`, update the MailSync type (lines 106-115):

```typescript
export type MailSync = {
  sync: (account: Account, options?: SyncOptions) => Promise<SyncResult>;
  fetchBody: (account: Account, emailId: number) => Promise<EmailBody>;
  disconnect: (accountId: number) => Promise<void>;
  cancel: (accountId: number) => Promise<void>;  // ADD THIS LINE
  onProgress: (cb: (p: SyncProgress) => void) => () => void;
  testConnection: (host: string, port: number, username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  getDefaultFolders: (imapHost: string) => string[];
  listFolders: (account: Account) => Promise<{ path: string; specialUse?: string }[]>;
  appendToSent: (account: Account, message: SentMessage) => Promise<void>;
};
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Type error in IMAP adapter (missing cancel method) - this is expected

**Step 3: Commit**

```bash
git add src/core/ports.ts
git commit -m "feat: add cancel method to MailSync port"
```

---

## Task 9: Add 'cancelled' to SyncProgress Phase

**Files:**
- Modify: `src/core/domain.ts`

**Step 1: Find SyncProgress type and update**

First, search for SyncProgress definition:

Run: `grep -n "SyncProgress" src/core/domain.ts`

Update the phase type to include 'cancelled':

```typescript
export type SyncProgress = {
  accountId: number;
  folder: string;
  phase: 'connecting' | 'counting' | 'fetching' | 'storing' | 'complete' | 'error' | 'cancelled';
  current: number;
  total: number;
  newCount: number;
  error?: string;
};
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors (yet - IMAP adapter still needs cancel)

**Step 3: Commit**

```bash
git add src/core/domain.ts
git commit -m "feat: add 'cancelled' phase to SyncProgress"
```

---

## Task 10: Implement cancel in IMAP Adapter

**Files:**
- Modify: `src/adapters/imap/index.ts`

**Step 1: Add AbortController tracking**

Near the top of `createMailSync` function (after line 137), add:

```typescript
  const abortControllers = new Map<number, AbortController>();
```

**Step 2: Update sync function to use AbortController**

In the sync function, at the start (where it begins sync for an account), add:

```typescript
    // Create abort controller for this sync
    const abortController = new AbortController();
    abortControllers.set(account.id, abortController);
```

At key points in the sync loop, add abort checks:

```typescript
    // Before each batch
    if (abortController.signal.aborted) {
      emitProgress({ ...progress, phase: 'cancelled' });
      return { newCount: 0, newEmailIds: [] };
    }
```

**Step 3: Implement the cancel method**

Add the cancel method to the returned object:

```typescript
    cancel: async (accountId: number) => {
      // Abort any in-progress sync
      const controller = abortControllers.get(accountId);
      if (controller) {
        controller.abort();
        abortControllers.delete(accountId);
      }

      // Close connection
      const conn = connections.get(accountId);
      if (conn) {
        try {
          await conn.client.logout();
        } catch {
          // Ignore logout errors during cancel
        }
        connections.delete(accountId);
      }
    },
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/adapters/imap/index.ts
git commit -m "feat: implement cancel method in IMAP adapter"
```

---

## Task 11: Add cancelSync Use Case

**Files:**
- Modify: `src/core/usecases.ts`

**Step 1: Add the use case**

After `syncAllWithAutoClassify` (around line 192), add:

```typescript
export const cancelSync = (deps: Pick<Deps, 'sync'>) =>
  (accountId: number): Promise<void> =>
    deps.sync.cancel(accountId);
```

**Step 2: Add to createUseCases factory**

In the createUseCases return object, add after `syncAllWithAutoClassify`:

```typescript
    cancelSync: cancelSync(deps),
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/core/usecases.ts
git commit -m "feat: add cancelSync use case"
```

---

## Task 12: Add sync:cancel IPC Handler

**Files:**
- Modify: `src/main/ipc.ts`

**Step 1: Add the handler**

After the `sync:startAll` handler (around line 252), add:

```typescript
  ipcMain.handle('sync:cancel', async (_, accountId) => {
    return useCases.cancelSync(assertPositiveInt(accountId, 'accountId'));
  });
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: add sync:cancel IPC handler"
```

---

## Task 13: Expose sync.cancel in Preload API

**Files:**
- Modify: `src/main/preload.ts:50-53`

**Step 1: Update sync object**

In `src/main/preload.ts`, update the sync object (lines 50-53):

```typescript
  sync: {
    start: (accountId: number, opts = {}) => ipcRenderer.invoke('sync:start', accountId, opts),
    startAll: (opts = {}) => ipcRenderer.invoke('sync:startAll', opts),
    cancel: (accountId: number) => ipcRenderer.invoke('sync:cancel', accountId),
  },
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: expose sync.cancel in preload API"
```

---

## Task 14: Update Store Types and Add cancelSync to SyncStore

**Files:**
- Modify: `src/renderer/stores/index.ts`

**Step 1: Update Window interface**

In the Window interface, update the sync type (around line 66-69):

```typescript
      sync: {
        start: (accountId: number, opts?: any) => Promise<number>;
        startAll: (opts?: any) => Promise<number>;
        cancel: (accountId: number) => Promise<void>;
      };
```

**Step 2: Update SyncStore type**

Update the SyncStore type (lines 385-393):

```typescript
type SyncStore = {
  syncing: boolean;
  syncingAccountId: number | null;
  progress: SyncProgress | null;
  lastSync: Date | null;
  lastError: string | null;

  startSync: (accountId: number) => Promise<void>;
  startSyncAll: () => Promise<void>;
  cancelSync: (accountId: number) => Promise<void>;
  setProgress: (progress: SyncProgress | null) => void;
};
```

**Step 3: Update SyncStore implementation**

Update the store implementation (lines 395-425):

```typescript
export const useSyncStore = create<SyncStore>((set, get) => ({
  syncing: false,
  syncingAccountId: null,
  progress: null,
  lastSync: null,
  lastError: null,

  startSync: async (accountId: number) => {
    set({ syncing: true, syncingAccountId: accountId, lastError: null });
    try {
      await window.mailApi.sync.start(accountId);
      set({ lastSync: new Date() });
    } catch (err) {
      set({ lastError: String(err) });
    } finally {
      set({ syncing: false, syncingAccountId: null, progress: null });
    }
  },

  startSyncAll: async () => {
    set({ syncing: true, syncingAccountId: null, lastError: null });
    try {
      await window.mailApi.sync.startAll();
      set({ lastSync: new Date() });
    } finally {
      set({ syncing: false, progress: null });
    }
  },

  cancelSync: async (accountId: number) => {
    try {
      await window.mailApi.sync.cancel(accountId);
    } finally {
      set({ syncing: false, syncingAccountId: null, progress: null });
    }
  },

  setProgress: (progress) => set({ progress }),
}));
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "feat: add cancelSync to SyncStore"
```

---

## Task 15: Create SyncButton Component

**Files:**
- Create: `src/renderer/components/SyncButton.tsx`

**Step 1: Create the component**

```typescript
/**
 * Sync Button Component
 *
 * Displays sync status and allows triggering/canceling sync.
 * Placed next to AccountSwitcher in the sidebar footer.
 */

import { IconRefresh } from 'obra-icons-react';
import { useSyncStore, useAccountStore } from '../stores';

export function SyncButton() {
  const { syncing, syncingAccountId, progress, lastError, startSync, cancelSync } = useSyncStore();
  const { selectedAccountId } = useAccountStore();

  const isSyncingCurrentAccount = syncing && syncingAccountId === selectedAccountId;

  const handleClick = async () => {
    if (!selectedAccountId) return;

    if (isSyncingCurrentAccount) {
      await cancelSync(selectedAccountId);
    } else {
      await startSync(selectedAccountId);
    }
  };

  // Determine tooltip text
  let tooltip = 'Sync account';
  if (isSyncingCurrentAccount) {
    if (progress) {
      tooltip = `Syncing ${progress.folder}: ${progress.current}/${progress.total} - Click to cancel`;
    } else {
      tooltip = 'Syncing... Click to cancel';
    }
  } else if (lastError) {
    tooltip = `Sync failed - Click to retry`;
  }

  return (
    <button
      onClick={handleClick}
      disabled={!selectedAccountId || (syncing && !isSyncingCurrentAccount)}
      className={`p-1.5 rounded-md transition-colors
        ${lastError && !syncing ? 'text-red-500 hover:bg-red-500/10' : ''}
        ${!lastError && !syncing ? 'hover:bg-[var(--color-bg-hover)]' : ''}
        ${syncing ? 'text-[var(--color-accent)]' : ''}
        disabled:opacity-50 disabled:cursor-not-allowed`}
      title={tooltip}
    >
      <IconRefresh
        className={`w-4 h-4 ${isSyncingCurrentAccount ? 'animate-spin' : ''}`}
        style={{ color: lastError && !syncing ? undefined : 'var(--color-text-tertiary)' }}
      />
    </button>
  );
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/renderer/components/SyncButton.tsx
git commit -m "feat: create SyncButton component"
```

---

## Task 16: Add SyncButton to AccountSwitcher Area

**Files:**
- Modify: `src/renderer/components/AccountSwitcher.tsx`

**Step 1: Import SyncButton**

At the top of the file, add:

```typescript
import { SyncButton } from './SyncButton';
```

**Step 2: Add SyncButton next to account trigger**

Update the return JSX. Wrap the existing button and add SyncButton:

Replace lines 73-88:

```typescript
  return (
    <div className="relative flex items-center gap-1" ref={dropdownRef}>
      {/* Sync button */}
      <SyncButton />

      {/* Account selector trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md
                   hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <AccountAvatar email={selected.email} size="sm" />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {selected.email}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1
                      rounded-lg border shadow-lg z-50"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          {accounts.map(account => (
            <button
              key={account.id}
              onClick={() => {
                selectAccount(account.id);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2
                         hover:bg-[var(--color-bg-hover)] first:rounded-t-lg last:rounded-b-lg"
            >
              <AccountAvatar email={account.email} size="sm" />
              <span className="text-sm truncate flex-1 text-left">{account.email}</span>
              {account.id === selectedAccountId && (
                <IconCheck className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/renderer/components/AccountSwitcher.tsx
git commit -m "feat: add SyncButton to AccountSwitcher area"
```

---

## Task 17: Wire Up Sync Progress Events

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Find existing sync:progress listener**

The App.tsx already has a sync:progress listener (around line 87). Update it to use the new store structure:

```typescript
  // Listen for sync progress
  useEffect(() => {
    const handleProgress = (progress: SyncProgress) => {
      useSyncStore.getState().setProgress(progress);

      // Reload emails when sync completes
      if (progress.phase === 'complete' || progress.phase === 'cancelled') {
        const accountId = useAccountStore.getState().selectedAccountId;
        if (accountId) {
          useEmailStore.getState().loadEmails(accountId);
        }
      }
    };

    window.mailApi.on('sync:progress', handleProgress);
    return () => window.mailApi.off('sync:progress', handleProgress);
  }, []);
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: update sync:progress handler for cancelled state"
```

---

## Task 18: Final Integration Test

**Step 1: Start the app**

Run: `npm run dev:electron`

**Step 2: Manual test checklist**

- [ ] Open an email with remote images
- [ ] Verify images auto-load after 200ms (if setting is 'auto')
- [ ] Switch emails rapidly - images should not load for skipped emails
- [ ] Sync button appears next to account name
- [ ] Click sync button - starts syncing, icon spins
- [ ] Click spinning sync button - cancels sync
- [ ] Sync progress shows in tooltip

**Step 3: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: auto-download images and sync button with cancel

- Add 'auto' option to RemoteImagesSetting
- Auto-load images on email open with 200ms debounce
- Add SyncButton component with cancel support
- Add cancelSync use case and IPC handler
- IMAP adapter uses AbortController for cancellation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add 'auto' to RemoteImagesSetting | ports.ts |
| 2 | Add autoLoadImagesForEmail use case | usecases.ts |
| 3 | Add images:autoLoad IPC handler | ipc.ts |
| 4 | Update images:setSetting for 'auto' | ipc.ts |
| 5 | Expose autoLoad in preload | preload.ts |
| 6 | Update store types | stores/index.ts |
| 7 | Update EmailViewer for auto-load | EmailViewer.tsx |
| 8 | Add cancel to MailSync port | ports.ts |
| 9 | Add 'cancelled' to SyncProgress | domain.ts |
| 10 | Implement cancel in IMAP adapter | imap/index.ts |
| 11 | Add cancelSync use case | usecases.ts |
| 12 | Add sync:cancel IPC handler | ipc.ts |
| 13 | Expose sync.cancel in preload | preload.ts |
| 14 | Update SyncStore with cancelSync | stores/index.ts |
| 15 | Create SyncButton component | SyncButton.tsx |
| 16 | Add SyncButton to AccountSwitcher | AccountSwitcher.tsx |
| 17 | Wire up sync progress events | App.tsx |
| 18 | Final integration test | - |
