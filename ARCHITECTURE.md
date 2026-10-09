# Mail Client Architecture

## Philosophy

This project follows **Clean Architecture** without the boilerplate. Key principles:

1. **Functional over OOP** - Use cases are functions, not classes
2. **Types as contracts** - TypeScript types define ports, no interface classes needed
3. **Composition root** - Wire dependencies at startup, inject via function parameters
4. **Pragmatic** - Works well with AI coding assistants due to clear boundaries

## Structure

```
src/
├── core/                   # Pure business logic (zero dependencies)
│   ├── domain.ts           # Types: Email, Account, ForgottenReply, DigestSettings, ...
│   ├── ports.ts            # Function type signatures for adapters (Deps)
│   ├── reply-scoring.ts    # Gate + rank unanswered mail (pure)
│   ├── system1/            # Types for the on-device model (Milestone 2)
│   ├── usecases/           # Use cases as curried functions, one file per area
│   │   ├── factory.ts      # createUseCases(deps)
│   │   ├── reply-usecases.ts   # findForgottenReplies, markReplyDone, snoozeReply, ...
│   │   └── digest-usecases.ts  # runDailyDigest, sendPendingDigestEmails, renderDigestEmail
│   └── index.ts
│
├── adapters/               # External implementations (create*() factories)
│   ├── db/                 # SQLite repositories, schema.sql, migrations
│   │   ├── email-signals-repo.ts       # per-email needs-reply / importance signals
│   │   ├── reply-candidate-repo.ts     # unanswered-mail SQL
│   │   └── reply-reminders-repo.ts     # done / dismissed / snoozed
│   ├── imap/               # IMAP sync and folder operations
│   ├── smtp/               # Sending (incl. the digest email)
│   ├── llm/                # Anthropic and Ollama classifiers
│   ├── triage/             # Pattern matcher, enhanced classifier and its decorators
│   │   ├── signal-recorder.ts  # withSignalRecording
│   │   └── body-privacy.ts     # withBodyPrivacy (no body text to cloud without opt-in)
│   ├── embeddings/         # Local sentence embeddings and vector search
│   ├── keychain/           # Secure credential storage (getPasswordIfUnlocked never prompts)
│   ├── notifications/      # createNotifier() - native OS notifications
│   └── ollama-manager/     # Bundled Ollama binary
│
├── main/                   # Electron main process
│   ├── index.ts            # Entry point: single-instance lock, startApp() once, window lifecycle
│   ├── container.ts        # Composition root - wires everything
│   ├── window-manager.ts   # getWindow()/showWindow(), sendToRenderer() (no Electron import)
│   ├── digest-wiring.ts    # Daily digest runtime: scheduler, wake catch-up, notification click
│   ├── preload.ts          # Secure bridge to renderer
│   ├── ipc/                # IPC handlers by domain, e.g. replies-handlers.ts, digest-handlers.ts
│   │   ├── index.ts        # registerIpcHandlers(getWindow, container) - once per process
│   │   └── *-handlers.ts   # validate input, call a use case
│   └── schedulers/         # digest-scheduler.ts, calibration-scheduler.ts
│
└── renderer/               # React UI
    ├── components/         # NeedsReplyView, settings/DigestSettings, ...
    ├── stores/             # Zustand stores
    └── App.tsx
```

## Security Model

Credentials are protected with layered security:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Encryption at Rest                            │
│  └─ Electron safeStorage (OS-level: Keychain/DPAPI)    │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Biometric Gate                                │
│  └─ Touch ID / Windows Hello required for decryption   │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Session Management                            │
│  └─ In-memory cache cleared on lock/timeout            │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Process Isolation                             │
│  └─ Renderer cannot access raw credentials via IPC     │
└─────────────────────────────────────────────────────────┘
```

### Biometric Modes

| Mode | Prompts | Use case |
|------|---------|----------|
| `always` | Every access | Paranoid |
| `session` | Once per 4h | **Default** |
| `lock` | After screen lock | Convenient |
| `never` | Never | Trust device |

## Data Flow

```
Renderer → IPC → Use Case → Port → Adapter → External (DB/IMAP/API)
```

### Electron lifecycle

The app process outlives its window (macOS keeps running after the last window closes so the
daily digest can still fire). Hence:

- Process-wide setup (container, IPC handlers, CSP hook, digest runtime) runs once in
  `startApp()`; creating a window only builds a `BrowserWindow`.
- The window is reached through `window-manager.ts`; IPC handlers that push events to the renderer
  take a window getter and no-op when there is none.
- `registerIpcHandlers` throws if called twice, and a single-instance lock stops a second copy
  from running a second digest.

See `docs/designs/2026-10-09-reply-digest-and-system1.md` for the reply digest design.

## Core Concepts

### Domain (core/domain.ts)
Pure TypeScript types. No classes, no dependencies.
```typescript
export type Email = { id: number; subject: string; ... }
export type Tag = { id: number; slug: string; ... }
```

### Ports (core/ports.ts)
Function signatures that adapters must implement:
```typescript
export type EmailRepo = {
  findById: (id: number) => Promise<Email | null>;
  list: (options: ListOptions) => Promise<Email[]>;
  ...
}
```

### Use Cases (core/usecases.ts)
Curried functions that take deps and return the actual function:
```typescript
export const listEmails = (deps: Pick<Deps, 'emails'>) =>
  (options: ListOptions): Promise<Email[]> =>
    deps.emails.list(options);
```

### Adapters (adapters/*)
Factory functions that return port implementations:
```typescript
export function createEmailRepo(): EmailRepo {
  return {
    async findById(id) { ... },
    async list(options) { ... },
  };
}
```

### Composition Root (main/container.ts)
Wires adapters to ports, creates use cases:
```typescript
const emails = createEmailRepo();
const deps = { emails, tags, sync, ... };
const useCases = createUseCases(deps);
```

## Why This Structure?

1. **AI-friendly** - Clear boundaries, easy to navigate
2. **Testable** - Just pass mock deps to use cases
3. **Flexible** - Swap adapters without touching core
4. **Simple** - No DI frameworks, no abstract factories
5. **Type-safe** - TypeScript enforces contracts

## Testing

```typescript
// Unit test a use case
const mockDeps = { emails: { list: async () => [testEmail] } };
const result = await listEmails(mockDeps)({ limit: 10 });
expect(result).toEqual([testEmail]);
```
