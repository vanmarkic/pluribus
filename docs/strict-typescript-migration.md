# Strict TypeScript migration

> Addresses issue #103.

TypeScript `strict: true` has been on since day one. This doc tracks the
incremental enablement of the three additional flags that a 2026
codebase is expected to carry: `noImplicitOverride`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Current state

| Flag | `tsconfig.main.json` | `tsconfig.evals.json` | `tsconfig.json` (renderer) |
|---|---|---|---|
| `strict` | ✓ | ✓ | ✓ |
| `noImplicitOverride` | ✓ | ✓ | ✓ |
| `noUncheckedIndexedAccess` | ✓ | ✓ | ✓ |
| `exactOptionalPropertyTypes` | ✓ | ✓ | ✓ |

All three post-`strict` flags now enforced project-wide across every
compilation target. The initial audits found 29 errors on the main
project and 77 on the renderer; all fixed.

## Categories the 29 fixes fell into

- **`Object possibly undefined` after index access** (7): tight loops
  (`a[i]`), entries destructuring (`entries[0]`), tier selection
  (`tiers[tierIdx]`) — fixed with `!` where the surrounding logic
  guarantees the index, `?.` + fallback where it doesn't.
- **`{foo: undefined}` against optional field** (16): every time we
  built an output object by writing `foo: maybeUndefined` instead of
  conditionally adding the key. `exactOptionalPropertyTypes` rejects
  this because the target type is `{foo?: T}` not `{foo?: T | undefined}`
  — a semantic distinction TS 2026 enforces. Fixed with conditional
  spreads `...(x !== undefined ? { foo: x } : {})`.
- **Record lookup with fallback key** (1): `PROVIDER_FOLDERS[provider]
  || PROVIDER_FOLDERS.default` tightened to
  `PROVIDER_FOLDERS[provider] ?? PROVIDER_FOLDERS['default']!` so the
  bracket access doesn't leak `undefined`.
- **Missing null guards at render boundaries** (5): protocol handlers
  and mailbox listers where an optional path segment could be
  undefined; surfaced with explicit early returns.

## Renderer migration (now done)

A follow-up commit enabled the same three flags on `tsconfig.json`
(the renderer / composite-root config). The audit surfaced 77
strict errors across 15 files, plus 21 pre-existing non-strict
errors that had been masked by a missing `@testing-library/dom`
peer dep and an absent jest-dom ambient type reference. Fix
categories mirrored the main project:

- **`Object possibly undefined` after index access**: EmailList
  (27 errors cleared by one row-null-guard early return),
  ClassificationSettings, useKeyboardShortcuts, useEmailListKeyboard,
  stores/index.ts.
- **`{foo: undefined}` against optional field**: App, AccountWizard,
  ComposeModal, Sidebar, AISortView, TriageReviewView,
  SecurityLogPanel, hooks. Fixed with conditional spreads.
- **jest-dom matchers**: new `src/renderer/vitest.d.ts` triple-slash
  references the jest-dom types so every `.tsx` test file gets
  `.toBeInTheDocument` / `.toHaveStyle` on its Assertion type
  without per-file imports. Installed the missing
  `@testing-library/dom` peer dep.
- **mockApi.ts**: stubbed the dynamically-added `streamExplain` /
  `onStreamEvent` methods so the `as MailAPI` cast holds under
  `exactOptionalPropertyTypes`.
