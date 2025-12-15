# Mail Client - Claude Code Instructions

## Project Overview

Privacy-focused Electron mail client with LLM-powered tagging. Uses Clean Architecture (functional style).

## Tech Stack

- **Runtime:** Electron 32 + Node.js
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

## Files to Ignore

- `.env*` files (API keys, credentials)
- `*.sqlite` database files
- `credentials.json`, `secrets.*`
