# Pluribus Mail Client

A privacy-focused Electron-based mail client with intelligent LLM-powered email triage and classification.

## Overview

Pluribus is a modern desktop email client that combines traditional IMAP/SMTP protocols with advanced AI classification to automatically organize your inbox. Built with privacy and security as core principles, it stores all credentials in your operating system's secure keychain and optionally uses biometric authentication.

The client features an innovative hybrid email triage system that uses pattern matching combined with LLM classification to automatically sort incoming emails into organized folders, helping you maintain a clean, actionable inbox.

## Key Features

### Intelligent Email Triage

- **Automatic Classification**: Emails are automatically sorted into folders like Inbox, Planning, Paper-Trail (Invoices, Admin, Travel), Feed, Social, and Promotions
- **Hybrid Approach**: Pattern matching for speed combined with LLM validation for accuracy
- **Learning System**: Improves over time through onboarding training and user corrections
- **Low-Confidence Review**: Uncertain classifications go to a Review folder for manual triage

### Privacy & Security

- **Layered Security**: Multi-layer protection including OS-level encryption (Keychain/DPAPI), biometric gates, session management, and process isolation
- **No Credential Storage**: Credentials never stored in SQLite or plain text
- **Biometric Authentication**: Optional Touch ID / Windows Hello integration
- **Process Isolation**: Renderer process cannot access raw credentials

### Clean Architecture

- **Functional Design**: Use cases implemented as curried functions instead of classes
- **Clear Boundaries**: Separation between core business logic, adapters, and UI
- **Type-Safe Contracts**: TypeScript types define all interfaces
- **AI-Friendly Structure**: Clear boundaries make the codebase easy to navigate and modify

## Tech Stack

### Runtime & Framework
- **Electron 32**: Cross-platform desktop application framework
- **Node.js**: Backend runtime

### Frontend
- **React 18**: UI library
- **Zustand**: State management
- **Tailwind CSS 4**: Utility-first CSS framework
- **Radix UI**: Accessible component primitives

### Backend
- **SQLite** (better-sqlite3): Local database
- **ImapFlow**: IMAP protocol implementation
- **Nodemailer**: SMTP email sending
- **Mailparser**: Email parsing

### AI/LLM
- **Anthropic Claude SDK**: Email classification and triage

### Build Tools
- **Vite**: Fast development server and bundler
- **TypeScript**: Type-safe JavaScript
- **Electron Builder**: Application packaging

## Project Structure

```
src/
├── core/               # Pure business logic (domain, ports, usecases)
│   ├── domain.ts       # Type definitions: Email, Tag, Account, etc.
│   ├── ports.ts        # Adapter interface contracts
│   └── usecases.ts     # Business logic as curried functions
│
├── adapters/           # External implementations
│   ├── db/             # SQLite repositories
│   ├── imap/           # IMAP sync operations
│   ├── llm/            # Claude classification
│   ├── triage/         # Email triage system
│   └── keychain/       # Secure credential storage
│
├── main/               # Electron main process
│   ├── container.ts    # Dependency injection composition root
│   ├── ipc.ts          # IPC handlers
│   ├── preload.ts      # Secure bridge to renderer
│   └── index.ts        # Application entry point
│
└── renderer/           # React UI
    ├── components/     # React components
    ├── stores/         # Zustand state stores
    └── App.tsx         # Main application component
```

**Data Flow**: `Renderer → IPC → Use Case → Port → Adapter → External (DB/IMAP/API)`

For detailed architecture information, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Installation

### Prerequisites

- Node.js 18+ and npm
- macOS 10.13+, Windows 10+, or Linux

### Setup

1. Clone the repository:
```bash
git clone https://github.com/vanmarkic/pluribus.git
cd pluribus
```

2. Install dependencies:
```bash
npm install
```

3. Rebuild native modules for Electron:
```bash
npm run rebuild:electron
```

## Development

### Available Commands

```bash
# Start Vite dev server (renderer process)
npm run dev

# Build main process and start Electron
npm run dev:electron

# Type check without emitting files
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Development Workflow

1. **UI Development**: Run `npm run dev` to start the Vite dev server with hot module replacement
2. **Full App Development**: Run `npm run dev:electron` to build and start the complete Electron application
3. **Type Checking**: Run `npm run typecheck` regularly to catch type errors

### Adding New Features

When adding functionality, follow the Clean Architecture pattern:

1. Define domain types in `src/core/domain.ts`
2. Add port signatures (interfaces) in `src/core/ports.ts`
3. Implement use cases in `src/core/usecases.ts`
4. Create adapters in `src/adapters/`
5. Wire dependencies in `src/main/container.ts`
6. Expose to renderer via IPC in `src/main/ipc.ts`

## Building

### Production Build

```bash
# Build for development
npm run build

# Create distributable for macOS
npm run dist

# Create DMG installer for macOS
npm run dist:dmg
```

The built application will be in the `release/` directory.

## Testing

The project uses Vitest for unit and integration testing:

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch
```

Tests are organized alongside source files:
- Unit tests: `*.test.ts`
- Use case tests: `src/core/usecases.test.ts`
- Domain tests: `src/core/domain.test.ts`

### Property-Based Testing

The project includes property-based testing for critical paths like email classification. See `docs/property-based-testing-results.md` for details.

## Email Triage System

The hybrid triage system automatically organizes incoming emails:

### Folder Structure

- **Inbox**: Urgent, actionable, important emails requiring attention
- **Planning**: Medium-term items without hard deadlines
- **Paper-Trail**: Organized into Invoices, Admin, and Travel subfolders
- **Feed**: Newsletters and curated content
- **Social**: Social media notifications (except direct messages)
- **Promotions**: Marketing and sales emails
- **Review**: Low-confidence classifications requiring manual triage

### How It Works

1. **Pattern Matching**: Fast initial classification using regex patterns and domain matching
2. **LLM Validation**: Claude validates or overrides pattern decisions with contextual understanding
3. **Confidence Threshold**: Low-confidence classifications (< 0.7) go to Review folder
4. **Learning System**: Improves through onboarding training and user corrections

For complete details, see [docs/designs/2025-12-16-email-triage-system.md](./docs/designs/2025-12-16-email-triage-system.md).

## Security Model

### Credential Protection

Credentials are protected through multiple security layers:

1. **Encryption at Rest**: Electron safeStorage with OS-level encryption (Keychain on macOS, DPAPI on Windows)
2. **Biometric Gate**: Optional Touch ID / Windows Hello required for decryption
3. **Session Management**: In-memory cache cleared on lock/timeout
4. **Process Isolation**: Renderer cannot access raw credentials via IPC

### Biometric Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `always` | Prompt every access | Maximum security |
| `session` | Prompt once per 4 hours | **Default** - Balanced |
| `lock` | Prompt after screen lock | Convenient |
| `never` | No biometric prompts | Trust device |

## Configuration

### Environment Variables

The application supports configuration through environment variables:

- `ANTHROPIC_API_KEY`: Claude API key for LLM classification (can also be configured in-app)
- Additional settings are stored securely in Electron Store

### User Settings

Settings are accessible through the application UI:
- Account management
- LLM provider configuration
- Triage preferences
- Security options

## Architecture Patterns

### Use Case Pattern

Use cases are curried functions that take dependencies first, then parameters:

```typescript
// Definition
export const listEmails = (deps: Pick<Deps, 'emails'>) =>
  (options: ListEmailsOptions = {}): Promise<Email[]> =>
    deps.emails.list(options);

// Usage
await useCases.listEmails({ limit: 50 });
```

### Port Pattern

Ports are TypeScript types defining adapter contracts:

```typescript
export type EmailRepo = {
  findById: (id: number) => Promise<Email | null>;
  list: (options: ListEmailsOptions) => Promise<Email[]>;
};
```

### Adapter Pattern

Adapters are factory functions returning port implementations:

```typescript
export function createEmailRepo(): EmailRepo {
  return {
    async findById(id) { /* ... */ },
    async list(options) { /* ... */ },
  };
}
```

## Contributing

### Code Style

- Prefer functions over classes
- Use TypeScript strict mode
- Keep `core/` free of external dependencies
- Name adapters as `create*()` factory functions
- Respect Clean Architecture boundaries

### Security Rules

- Never store credentials in plain text or SQLite
- Always use `adapters/keychain` for sensitive data
- Never expose raw credentials to renderer process
- Validate all IPC inputs

### Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes following the code style
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

See LICENSE file for details.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architecture documentation
- [CLAUDE.md](./CLAUDE.md) - Claude Code Agent instructions
- [docs/designs/](./docs/designs/) - Design documents
- [docs/plans/](./docs/plans/) - Implementation plans
- [docs/testing/](./docs/testing/) - Testing documentation

## Support

For issues, questions, or contributions, please visit the [GitHub repository](https://github.com/vanmarkic/pluribus).
