# Auto-Download Images & Sync Button Design

## Overview

Two features for the mail client:
1. **Auto-download images on email open** - Automatically fetch and cache remote images when user opens an email
2. **Sync button** - Visible button next to account name to trigger sync, with cancel support

## Feature 1: Auto-Download Images

### Current Flow
```
User opens email → HTML sanitized → Images blocked → User clicks "Load Images" → Images cached
```

### New Flow
```
User opens email → HTML sanitized → Auto-trigger image loading → Images cached → Re-render
```

### Implementation

**Setting change:**
- Current values: `'block'` | `'allow'`
- New values: `'block'` | `'allow'` | `'auto'` (new default)
  - `block`: Manual load only (current behavior)
  - `allow`: Load from remote servers directly (no caching)
  - `auto`: Auto-download and cache on email open

**New use case:** `autoLoadImagesForEmail`
```typescript
// core/usecases.ts
export const autoLoadImagesForEmail = (deps: Pick<Deps, 'images' | 'imageCache'>) =>
  async (emailId: number): Promise<CachedImage[]> => {
    const setting = await deps.images.getSetting();
    if (setting === 'block') return [];

    const alreadyLoaded = await deps.imageCache.hasLoaded(emailId);
    if (alreadyLoaded) {
      return deps.imageCache.getCachedImages(emailId);
    }

    // Trigger fetch and cache
    return deps.imageCache.cacheImages(emailId, urls);
  };
```

**IPC handler:** `images:autoLoad`

**EmailViewer changes:**
- Remove "Load Images" banner when setting is `'auto'`
- useEffect triggers auto-load when emailId changes
- Debounce 200ms to handle rapid email switching
- Show subtle loading indicator while fetching

### Performance

- Email body renders immediately with placeholders
- Images load in background (batch of 5 concurrent)
- Cancel pending loads if user switches emails within 200ms

## Feature 2: Sync Button

### Location

Bottom-left, next to account name in the account switcher area.

### Component: SyncButton

```
AccountSwitcher
├── Account name + email
├── SyncButton [NEW]
│   ├── Icon: refresh (idle) / spinner (syncing)
│   └── onClick: start or cancel sync
└── Dropdown trigger
```

### States

| State | Icon | Tooltip | onClick |
|-------|------|---------|---------|
| Idle | ↻ (refresh) | "Sync account" | Start sync |
| Syncing | ◌ (spinner) | "Cancel sync" | Cancel sync |
| Error | ↻ (red) | "Sync failed - retry" | Start sync |

### Sync Cancellation

**New port method:**
```typescript
// core/ports.ts
type SyncPort = {
  start: (accountId: number, opts?: SyncOptions) => Promise<SyncResult>;
  cancel: (accountId: number) => Promise<void>;  // NEW
};
```

**New use case:** `cancelSync`
```typescript
export const cancelSync = (deps: Pick<Deps, 'sync'>) =>
  (accountId: number): Promise<void> =>
    deps.sync.cancel(accountId);
```

**IMAP adapter changes:**
- Track AbortController per sync operation
- `cancel()` calls `controller.abort()` and closes connection
- New progress phase: `'cancelled'`

**IPC handler:** `sync:cancel`

**Sync store changes:**
```typescript
// Add to useSyncStore
cancelSync: (accountId: number) => Promise<void>
isCancelling: boolean
```

### Data Flow

**Start sync:**
```
SyncButton click (idle)
  → useSyncStore.startSync(accountId)
  → window.mailApi.sync.start(accountId)
  → IPC: sync:start
  → syncWithAutoClassify use case
  → Progress events → UI updates
```

**Cancel sync:**
```
SyncButton click (syncing)
  → useSyncStore.cancelSync(accountId)
  → window.mailApi.sync.cancel(accountId)
  → IPC: sync:cancel
  → cancelSync use case
  → IMAP adapter aborts
  → Progress: { phase: 'cancelled' }
```

## Architecture Summary

### New Ports (core/ports.ts)
```typescript
type SyncPort = {
  cancel: (accountId: number) => Promise<void>;
};

type ImageSettingValue = 'block' | 'allow' | 'auto';
```

### New Use Cases (core/usecases.ts)
```typescript
autoLoadImagesForEmail: (deps) => (emailId: number) => Promise<CachedImage[]>
cancelSync: (deps) => (accountId: number) => Promise<void>
```

### New IPC Handlers (main/ipc.ts)
- `images:autoLoad` - Auto-load images for email
- `sync:cancel` - Cancel in-progress sync

### New Components (renderer)
- `SyncButton` - Refresh/cancel button with states

## Testing Strategy (TDD)

### Unit Tests (Core)
- `autoLoadImagesForEmail` returns cached URLs when already loaded
- `autoLoadImagesForEmail` triggers fetch when not loaded
- `autoLoadImagesForEmail` respects 'block' setting
- `cancelSync` calls adapter cancel method

### Integration Tests (Adapters)
- IMAP cancel aborts connection
- Image cache handles concurrent requests

### Component Tests (Renderer)
- SyncButton renders correct icon per state
- SyncButton click triggers correct action per state
- EmailViewer triggers auto-load on email change
- EmailViewer debounces rapid email switching

## Files to Modify

| File | Changes |
|------|---------|
| `core/ports.ts` | Add cancel to SyncPort, update ImageSettingValue |
| `core/usecases.ts` | Add autoLoadImagesForEmail, cancelSync |
| `adapters/imap/index.ts` | Add cancel support with AbortController |
| `main/ipc.ts` | Add images:autoLoad, sync:cancel handlers |
| `main/preload.ts` | Expose new IPC methods |
| `renderer/stores/index.ts` | Add cancelSync to sync store |
| `renderer/components/EmailViewer.tsx` | Add auto-load logic |
| `renderer/components/SyncButton.tsx` | New component |
| `renderer/components/AccountSwitcher.tsx` | Include SyncButton |

## Test Files to Create

```
src/core/__tests__/usecases.test.ts (add cases)
src/adapters/imap/__tests__/cancel.test.ts (new)
src/renderer/components/__tests__/SyncButton.test.tsx (new)
src/renderer/components/__tests__/EmailViewer.test.tsx (add cases)
```
