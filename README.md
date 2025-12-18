# Pluribus Mail Client

A privacy-focused Electron mail client with LLM-powered email triage and intelligent classification.

## 🌟 Features

- **Privacy-First Design** - Your emails stay on your device with encrypted credential storage
- **Intelligent Email Triage** - Automatic classification using local LLM
- **Smart Folder Organization** - Emails automatically sorted into Inbox, Planning, Feed, Social, Promotions, and Paper-Trail
- **Native Experience** - Built with Electron for seamless macOS integration
- **Secure Credential Management** - OS-level encryption with Touch ID/biometric support
- **Clean Architecture** - Maintainable codebase with functional programming principles

## 🏗️ Architecture

This project follows a **functional clean architecture** pattern with three distinct layers:

- **Core** (`src/core/`) - Pure business logic with zero external dependencies
- **Adapters** (`src/adapters/`) - External integrations (SQLite, IMAP, SMTP, LLM)
- **Main** (`src/main/`) - Electron process coordination and IPC handling
- **Renderer** (`src/renderer/`) - React-based user interface

For detailed architecture information, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Runtime** | Electron 32, Node.js |
| **Frontend** | React 18, Zustand, Tailwind CSS 4 |
| **Backend** | SQLite (better-sqlite3), IMAP (imapflow), SMTP (nodemailer) |
| **AI/LLM** | Local Ollama with model of choice, tested with Mistral 7b |
| **Build** | Vite, TypeScript, Electron Builder |

## 🔐 Security Features

Multi-layered security architecture protects your credentials:

1. **Encryption at Rest** - OS-level keychain (macOS Keychain, Windows DPAPI)
2. **Biometric Gate** - Touch ID/Windows Hello authentication
3. **Session Management** - In-memory credential caching with automatic clearing
4. **Process Isolation** - Renderer process cannot access raw credentials

### Biometric Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `always` | Prompt every access | Maximum security |
| `session` | Prompt once per 4 hours | **Default** - Balance security & convenience |
| `lock` | Prompt after screen lock | Convenient with system lock |
| `never` | No biometric prompts | Trusted device |

## 📧 Email Triage System

Hybrid classification system combining pattern matching with LLM intelligence:

- **Pattern Matching** - Fast rule-based sorting for common patterns
- **LLM Classification** - Local LLM analyzes email content and context
- **Folder Mapping** - Automatic IMAP folder synchronization
- **Smart Categories** - Inbox, Planning, Feed, Social, Promotions, Paper-Trail

Learn more in [docs/designs/2025-12-16-email-triage-system.md](docs/designs/2025-12-16-email-triage-system.md).

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- macOS (currently supported platform)
- 8gb of RAM for local Mistral 7B

### Installation

```bash
# Clone the repository
git clone https://github.com/vanmarkic/pluribus.git
cd pluribus

# Install dependencies
npm install

# Rebuild native modules for Electron
npm run rebuild:electron
```

### Development

```bash
# Start Vite dev server (hot reload for renderer)
npm run dev

# In another terminal, build and start Electron
npm run dev:electron
```

### Building

```bash
# Create production build
npm run build

# Package as DMG for macOS
npm run dist:dmg
```

## 🧪 Testing

```bash
# Run tests once
npm test

# Watch mode for development
npm run test:watch

# Type checking
npm run typecheck
```

## 📚 Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed architecture overview
- [CLAUDE.md](CLAUDE.md) - AI assistant coding guidelines
- [docs/](docs/) - Additional design documents and plans

## 🤝 Contributing

This project follows clean architecture principles and functional programming patterns. Key guidelines:

- Use curried functions for use cases, not classes
- Keep `core/` free of external dependencies
- Store credentials only via the keychain adapter
- Validate all IPC inputs
- Follow existing code patterns and TypeScript strict mode

See [CLAUDE.md](CLAUDE.md) for detailed development guidelines.

## 📝 License

**PROPRIETARY SOFTWARE**

Copyright © 2024-2025 Media XP SRL (BE1004822703). All rights reserved.

This software is proprietary and confidential. It may not be used, copied, modified, 
or distributed without the express written consent of Media XP SRL.

If you have been granted access to this repository while it is private, you are 
invited for a preview only. This does not grant you any license or right to use 
the software.

For licensing inquiries, please contact Media XP SRL.

## 🔗 Links

- **Repository**: [github.com/vanmarkic/pluribus](https://github.com/vanmarkic/pluribus)
- **Issues**: [github.com/vanmarkic/pluribus/issues](https://github.com/vanmarkic/pluribus/issues)

---

**Note**: This is an early-stage project under active development. Features and APIs may change.
