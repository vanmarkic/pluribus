# Strict TypeScript migration

> Addresses issue #103.

TypeScript `strict: true` has been on since day one. This doc tracks the
incremental enablement of the three additional flags that a 2026
codebase is expected to carry: `noImplicitOverride`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Current state

| Flag | `tsconfig.main.json` | `tsconfig.evals.json` |
|---|---|---|
| `strict` | ✓ | ✓ |
| `noImplicitOverride` | **✓ (this commit)** | **✓ (this commit)** |
| `noUncheckedIndexedAccess` | open | **✓ (this commit)** |
| `exactOptionalPropertyTypes` | open | **✓ (this commit)** |

The evals path is the leading edge — smaller surface, newer code, no
legacy. The main project is the trailing edge and carries ~100 errors
under the remaining two flags, distributed across renderer stores and
a few long-lived adapters (db/mappers, imap, triage).

## Why split?

Enabling `noUncheckedIndexedAccess` across `src/main/**` and
`src/adapters/**` produces ~105 errors. Each one is a real correctness
improvement (array indexing, map lookups, record-key access) but the
fixes are individually tiny and the review load for a single 100-file
commit would be disproportionate to the risk.

The plan is to migrate one adapter at a time, each under its own
commit with a commit message of the form `tsconfig: enable
noUncheckedIndexedAccess on <path>`. Once every subtree is clean, the
flag graduates to the project root.

## Rough migration order

1. `src/adapters/observability/**` — tiny.
2. `src/adapters/keychain/**` — medium.
3. `src/adapters/llm/**` — already mostly clean (prompts, streaming,
   calibration, fallback, risk-tier, prompt-injection were written under
   the strict flag).
4. `src/adapters/db/**` — the bulk of the errors live here, in the
   mappers and the classification-state repo's long SELECT statements.
5. `src/core/**` — tests depend on `Partial<Deps>` patterns that need
   re-examining first.
6. `src/main/**`.
7. `src/renderer/**`.

## How to help

1. Pick an unmigrated subtree from the list above.
2. Add the flag to a scoped tsconfig (or patch the main one) and count
   errors: `npx tsc --noEmit -p tsconfig.main.json 2>&1 | head`.
3. Fix with nullish-coalescing / index guards.
4. Check the flag in for that subtree only (either via a scoped
   tsconfig or by waiting until the whole project is clean).
5. Run `npm test`.
