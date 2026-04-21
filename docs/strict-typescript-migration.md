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
| `noImplicitOverride` | ✓ | ✓ |
| `noUncheckedIndexedAccess` | ✓ | ✓ |
| `exactOptionalPropertyTypes` | ✓ | ✓ |

All three post-`strict` flags now enforced project-wide across
core / adapters / main. The initial audit found 29 errors; all fixed
and the flags landed together in the commit that opens this doc.

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

## Open items (renderer-side)

`src/renderer/**` is excluded from both tsconfigs for build reasons
unrelated to strictness — the renderer is compiled through Vite, not
tsc. A future commit can plug the flags into `tsconfig.json` (the
renderer-facing config that's also composite-referenced from the main
one) once the renderer's jsx/vite pipeline is audited.
