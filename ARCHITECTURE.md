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
│   ├── domain.ts           # Types: Email, Tag, Account, etc.
│   ├── ports.ts            # Function type signatures for adapters
│   ├── usecases.ts         # Use cases as curried functions
│   └── index.ts
│
├── adapters/               # External implementations
│   ├── db/                 # SQLite repositories
│   │   ├── schema.sql
│   │   └── index.ts        # createEmailRepo(), createTagRepo(), etc.
│   ├── imap/               # IMAP sync
│   │   └── index.ts        # createMailSync()
│   ├── llm/                # Claude classification
│   │   └── index.ts        # createClassifier()
│   └── keychain/           # Secure credential storage
│       └── index.ts        # createSecureStorage()
│
├── main/                   # Electron main process
│   ├── container.ts        # Composition root - wires everything
│   ├── ipc.ts              # IPC handlers
│   ├── preload.ts          # Secure bridge to renderer
│   └── index.ts            # Entry point
│
└── renderer/               # React UI
    ├── components/
    │   └── SecuritySettings.tsx
    ├── stores/
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
