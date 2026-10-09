# Mail Client - Claude Code Instructions

## Project Overview

Privacy-focused Electron mail client with LLM-powered email triage. Uses Clean Architecture (functional style).

**Email Triage System:** Hybrid folder-based triage using pattern matching + LLM classification. Emails are automatically moved to IMAP folders (Inbox, Planning, Feed, Social, Promotions, Paper-Trail/*). See `docs/designs/2025-12-16-email-triage-system.md` for details.

**Reply digest ("Needs your reply"):** Finds important received mail that has no reply yet and reminds the user once a day (native notification + email to self). See `docs/designs/2026-10-09-reply-digest-and-system1.md`.

## Tech Stack

- **Runtime:** Electron 35 + Node.js 22
- **Frontend:** React 18 + Zustand + Tailwind CSS 4
- **Backend:** SQLite (better-sqlite3), IMAP (imapflow), SMTP (nodemailer)
- **LLM:** Anthropic Claude SDK for email classification
- **Build:** Vite + TypeScript

## Architecture

```
src/
├── core/           # Pure business logic (domain, ports, usecases)
├── adapters/       # External implementations (db, imap, llm, keychain)
├── main/           # Electron main process (container, ipc, preload)
└── renderer/       # React UI (components, stores)
```

**Data flow:** `Renderer → IPC → Use Case → Port → Adapter → External`

## Key Patterns

1. **Functional Clean Architecture** - Use cases are curried functions, not classes
2. **Types as contracts** - `core/ports.ts` defines interfaces via TypeScript types
3. **Composition root** - `main/container.ts` wires all dependencies at startup
4. **Layered security** - Credentials protected via OS keychain + biometric gates

## Architecture Reference

This project uses a **3-layer functional clean architecture**:

| Layer | Location | Purpose |
|-------|----------|---------|
| **Core** | `src/core/` | Pure business logic, zero dependencies |
| **Adapters** | `src/adapters/` | External implementations (DB, IMAP, LLM) |
| **Main** | `src/main/` | Electron process, DI container, IPC |

### Use Case Pattern

Use cases are **curried functions** that take deps first, then parameters:

```typescript
// Definition in core/usecases.ts
export const listEmails = (deps: Pick<Deps, 'emails'>) =>
  (options: ListEmailsOptions = {}): Promise<Email[]> =>
    deps.emails.list(options);

// Wiring in main/container.ts
const useCases = { listEmails: listEmails(deps) };

// Usage
await useCases.listEmails({ limit: 50 });
```

### Port Pattern

Ports are **TypeScript types** defining adapter contracts:

```typescript
// core/ports.ts
export type EmailRepo = {
  findById: (id: number) => Promise<Email | null>;
  list: (options: ListEmailsOptions) => Promise<Email[]>;
  // ...
};

export type Deps = {
  emails: EmailRepo;
  tags: TagRepo;
  // ...
};
```

### Adapter Pattern

Adapters are **factory functions** returning port implementations:

```typescript
// adapters/db/index.ts
export function createEmailRepo(): EmailRepo {
  return {
    async findById(id) {
      const row = getDb().prepare('SELECT * FROM emails WHERE id = ?').get(id);
      return row ? mapEmail(row) : null;
    },
    // ...
  };
}
```

### Row Mapper Pattern

Database adapters use **mapper functions** to convert DB rows to domain types:

```typescript
function mapEmail(row: any): Email {
  return {
    id: row.id,
    subject: row.subject || '',
    from: { address: row.from_address, name: row.from_name },
    date: new Date(row.date),
    // ...
  };
}
```

### IPC Boundary Pattern

IPC handlers **validate all inputs** and call use cases:

```typescript
// main/ipc.ts
ipcMain.handle('emails:list', (_, opts) => {
  const validated = assertListOptions(opts);
  return useCases.listEmails(validated);
});
```

## Reply Digest

**Data flow:** triage (System 2 LLM) → `email_signals` → reply-candidate SQL → scoring → digest scheduler → notification + email to self.

- `withSignalRecording` stores `needsReply` / `importance` per email in `email_signals` (source `user` > `system2` > `system1`); `core/reply-scoring.ts` gates (importance ≥ 3 and needsReply ≥ 0.6, or a French/English text heuristic when there is no signal) and ranks.
- `reply-candidate-repo` anti-joins received mail against the user's own sent mail (In-Reply-To, References, same-thread-later) and `reply_reminders` (done / dismissed / snoozed).
- `main/digest-wiring.ts` + `main/schedulers/digest-scheduler.ts` run the digest once per local day with launch/wake catch-up. Email is sent with `sender.send` directly (never lands in Sent).
- The user's mail is mostly French: never rely on English phrases or `?` alone.

**Privacy invariants (do not break; all have tests):**

- Body previews (and the body-derived snippet) reach an LLM only for local models (Ollama) unless `llm.sendBodyExcerptsToCloud` is true. `withBodyPrivacy` enforces this at the last moment, so every new triage path must go through the container's decorated `triageClassifier`.
- The digest email and the notification never contain body text or snippets. The notification shows a count unless `digest.showSubjects`.
- `secrets.getPasswordIfUnlocked` never prompts for biometrics. A scheduled digest may only trigger Touch ID if `digest.allowBiometricPrompt` is on; otherwise the sync is skipped and the email is deferred until credentials are unlocked.
- `digestState` is internal; never expose it over IPC.

## Electron Lifecycle

- Process-wide setup (CSP hook, container, `registerIpcHandlers`, digest runtime) runs **once** in `startApp()` in `main/index.ts`. Never create a container or register IPC handlers when a window is created: `ipcMain.handle` throws on duplicates, and `registerIpcHandlers` throws if called twice.
- The window is owned by `main/window-manager.ts` (`getWindow()` / `showWindow()`). It can be closed and re-created while the app keeps running (macOS), so handlers that push events to the renderer take a window **getter** and use `sendToRenderer(getWindow, channel, payload)`; never capture a `BrowserWindow`.
- A single-instance lock keeps two copies from both sending the daily digest.
- Keep Electron-only pieces injectable (window factory, `NotificationCtor`, power monitor) so the logic is testable under vitest.

## Commands

```bash
npm run dev           # Start Vite dev server (renderer)
npm run dev:electron  # Build main + start Electron
npm run build         # Production build
npm run typecheck     # TypeScript check without emit
```

## Development Guidelines

### Adding Features

1. Define types in `core/domain.ts`
2. Add port signatures in `core/ports.ts`
3. Implement use case in `core/usecases.ts`
4. Create adapter in `adapters/`
5. Wire in `main/container.ts`
6. Expose via IPC in `main/ipc.ts`

### Security Rules

- **Never** store credentials in plain text or SQLite
- **Always** use `adapters/keychain` for sensitive data
- **Never** expose raw credentials to renderer process
- Validate all IPC inputs

### Adding a Renderer-Facing API

A new `window.mailApi` method must be added in **all 4 places**, or the app, the demo build or Storybook breaks:

1. `src/main/preload.ts` (and the channel in the allowlist if it is a push event)
2. `declare global` → `Window.mailApi` in `src/renderer/stores/index.ts`
3. `src/renderer/mockApi.ts` (with realistic fixtures)
4. `.storybook/mockMailApi.ts`

### Code Style

- Prefer functions over classes
- Use TypeScript strict mode
- Keep `core/` free of external dependencies
- Name adapters as `create*()` factory functions
- **Respect the Clean Architecture** - IPC handlers must call use cases, never adapters directly

## Testing

```typescript
// Mock deps for unit tests
const mockDeps = { emails: { list: async () => [testEmail] } };
const result = await listEmails(mockDeps)({ limit: 10 });
```

```bash
npx vitest run                          # all tests
npx tsc --noEmit -p tsconfig.main.json  # also: tsconfig.renderer.json, tsconfig.evals.json
```

- Vitest runs in **jsdom** globally. Do **not** add `// @vitest-environment node`: `src/renderer/__tests__/setup.ts` touches `window` and the file will fail. better-sqlite3, `crypto` and fake timers all work under jsdom.
- DB tests use in-memory SQLite: `initDb(':memory:', SCHEMA_PATH)` in `beforeEach`, `closeDb()` in `afterEach` (see `src/adapters/db/awaiting-repo.test.ts`).
- Code that needs Electron (windows, `Notification`, `powerMonitor`) takes the Electron piece as a parameter, or tests `vi.mock('electron', ...)`, so it runs without Electron.
- `tsconfig.test.json` has pre-existing errors and is not part of CI; new test files should not add any.

## Files to Ignore

- `.env*` files (API keys, credentials)
- `*.sqlite` database files
- `credentials.json`, `secrets.*`
