# Pluribus — Threat model (STRIDE)

> Last reviewed: 2026-04-21. Addresses issue #101.

Pluribus is an Electron desktop client that reads email over IMAP, stores
it locally in SQLite, and classifies it via an LLM (Anthropic Claude
hosted; Ollama optional local fallback). Because every email body is
untrusted input that is both rendered in the UI and fed to an LLM, the
attack surface is broader than a typical mail client.

This document is intentionally short and traceable — every mitigation
points at concrete source lines so a reviewer can verify claims.

## Assets and trust boundaries

| Asset | Confidentiality | Integrity | Availability |
|---|---|---|---|
| IMAP credentials (passwords) | **high** | high | med |
| Anthropic API key | **high** | high | med |
| Email bodies + attachments cache | high | med | low |
| Classification state + feedback | low | med | low |
| Prompts & prompt versions | low | **high** (lockout vector) | med |
| LLM budget counters | low | med | med |

Trust boundaries (inward ⇒ more trusted):

```
external network  →  IMAP/SMTP/Anthropic APIs
     ┆
Electron main process (Node, full FS/keychain)   ⇐ trusted
     ┆ preload bridge (contextIsolation)
Electron renderer process (Chromium, sandboxed)  ⇐ untrusted
     ┆ DOMPurify-sanitised iframe for email HTML  ⇐ hostile
```

The renderer is treated as semi-trusted; rendered email HTML is treated
as adversarial.

## STRIDE

### S — Spoofing

| Threat | Mitigation | Evidence |
|---|---|---|
| Renderer impersonates a privileged IPC caller | contextIsolation + preload allowlist; no `nodeIntegration` | `src/main/preload.ts`, Electron config in `src/main/index.ts` |
| Attacker tricks the classifier into impersonating the user ("you are now …") | System-prompt "treat content as untrusted" rule + regex detector + pattern cache quarantine | `src/adapters/llm/prompt-injection.ts`, `src/adapters/llm/prompts/classify.v3.ts`, `src/adapters/llm/anthropic.ts` (`shouldQuarantine` gate) |
| Malicious sender address used to bypass sender-rule routing | Sender-rule match is advisory; LLM classifier still runs and the agent loop can pull `get_sender_history` for evidence | `src/adapters/llm/agent-tools.ts` |

### T — Tampering

| Threat | Mitigation | Evidence |
|---|---|---|
| Tampering with stored credentials on disk | OS keychain (macOS Keychain / Windows Cred Vault / libsecret) via Electron `safeStorage` | `src/adapters/keychain/index.ts` |
| Tampering with SQLite file to inject fake classifications | Local-only app, OS filesystem permissions; SQLite opened with `PRAGMA foreign_keys=ON` | `src/adapters/db/connection.ts` |
| Silent prompt change shipped as code | Prompts versioned (`classify.v3.ts`, `classify.v4.ts`), challenger gated by env, eval-harness CI gate on macro-F1 | `src/adapters/llm/prompts/`, `.github/workflows/ci.yml`, `src/evals/` |
| In-flight tampering with Anthropic traffic | HTTPS + SDK pinning; budget gate prevents uncapped spend on compromised responses | `package.json` (`@anthropic-ai/sdk`), budget check in `createClassifier` |

### R — Repudiation

| Threat | Mitigation | Evidence |
|---|---|---|
| User or attacker denies credential access | All keychain reads/writes + deletes emit rows into `security_events` via the audit decorator | `src/adapters/keychain/audit.ts` |
| Attacker triggers classifier misbehaviour without a trace | Every LLM call persisted to `llm_calls` (cost, latency, prompt version, email id); every prompt-injection finding and fallback transition persisted to `security_events` | `src/adapters/db/llm-calls-repo.ts`, `src/adapters/db/security-event-repo.ts`, container sinks |

### I — Information disclosure

| Threat | Mitigation | Evidence |
|---|---|---|
| Renderer exfiltrates keychain via JS | `contextIsolation: true`, `sandbox: true`; keychain port reachable only via allowlisted preload bridge; no preload method exposes raw secret values | `src/main/preload.ts` |
| Email body leaks through rendered HTML (CSS `url()`, `javascript:`, tracking pixels) | DOMPurify + explicit CSS vector strip; remote images blocked by default | `src/main/index.ts` CSP, image cache adapter |
| LLM vendor logs sensitive content | Scope-limited prompt: subject + first 2 KB of body + delimited `<email_content>` block; no attachments forwarded | `src/adapters/llm/anthropic.ts` `buildUserMessage` |
| Audit log itself leaks secrets | Keychain decorator records only service/account identifier, never the secret value; this invariant has a unit test | `src/adapters/keychain/audit.ts`, `src/adapters/keychain/audit.test.ts` (`'never forwards the secret value into the audit row'`) |
| At-rest cache of emails is plaintext | ✅ AES-256-GCM envelope per row (iv‖ciphertext‖tag, base64, `v1:` prefix), passphrase in OS keychain, opt-in via `PLURIBUS_ENCRYPT_BODIES=1` so existing databases don't need a forced migration — legacy plaintext rows decrypt as pass-through. | `src/adapters/keychain/body-cipher.ts`, `src/adapters/db/email-repo-encryption.ts`, `src/adapters/keychain/body-passphrase.ts` |

### D — Denial of service

| Threat | Mitigation | Evidence |
|---|---|---|
| Attacker floods IPC with invalid inputs | Per-handler rate limit + input validation; Zod validation where migrated (#97) | `src/main/ipc/validation.ts` |
| Expensive prompt-injection payload blows LLM budget | Daily per-user budget + email-count limit + pattern cache quarantine for quarantined classifications | `createClassifier` budget gate; `shouldQuarantine` → cache skip |
| Anthropic outage → classifier down | Two-tier fallback chain (user model → Haiku 4.5) with jittered backoff; pattern cache still returns on familiar senders | `src/adapters/llm/fallback.ts` |
| Prompt-cache stampede across workspaces | Anthropic cache is workspace-isolated as of 2026-02-05; per-prompt cache_control with 5m default TTL | `src/adapters/llm/anthropic.ts` |

### E — Elevation of privilege

| Threat | Mitigation | Evidence |
|---|---|---|
| Rogue IPC handler gains main-process capabilities from the renderer | Allowlist in `preload.ts`; every handler validates inputs and delegates to a use case, never directly to an adapter | `src/main/ipc/*-handlers.ts` |
| Tool-use agent executes a tool with dangerous side effects | Agent tools are **read-only** (search embeddings, look up sender history); no write tools are registered | `src/adapters/llm/agent-tools.ts` |
| Model returns an unknown folder string and triggers unintended IMAP behaviour | Response JSON is validated against `TRIAGE_FOLDERS`; unknown folders fall back to INBOX with reduced confidence | `parseClassification` in `src/adapters/llm/anthropic.ts` |

## Residual risks (known, accepted or tracked)

1. **Stricter CSP** — `'unsafe-inline'` on `style-src` still allowed for
   DOMPurify-sanitised email rendering. See `docs/security/csp.md` for
   the migration plan.
2. **Zod coverage at IPC** — three most-recently added handlers migrated;
   older handlers still use handwritten assertions. Tracked under #97.
3. **Body encryption default-on** — currently opt-in via
   `PLURIBUS_ENCRYPT_BODIES=1` so existing databases keep working
   unchanged. Graduating to default-on needs a user-facing migration
   UX (progress bar + recovery if the keychain entry is lost).
4. **Ollama fallback tier** — not yet part of the fallback chain. Minor,
   tracked as future work to #95.
5. **Supply-chain risk on `@xenova/transformers` model download** —
   default HuggingFace source, no pinned hashes. Accepted risk.

## Review cadence

This document is reviewed on every merge to `main` touching
`src/adapters/llm/**`, `src/adapters/keychain/**`, or `src/main/ipc/**`.
