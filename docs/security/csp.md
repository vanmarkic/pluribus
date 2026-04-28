# Content Security Policy

> Last reviewed: 2026-04-21. Addresses issue #100.

Pluribus applies a CSP in two places:
1. **Runtime header** in `src/main/index.ts` — attached to every renderer
   response by `session.webRequest.onHeadersReceived`.
2. **Meta fallback** in `index.html` — covers the initial document
   load before the header is wired.

The two strings are kept roughly in sync; the header is authoritative
at runtime.

## Current directives

| Directive | Production value | Dev value | Rationale |
|---|---|---|---|
| `default-src` | `'self'` | same | Deny-by-default baseline. |
| `script-src` | `'self'` | `'self' 'unsafe-inline' http://localhost:5173` | Vite HMR needs inline scripts in dev; production bundles everything. |
| `style-src` | `'self' 'unsafe-inline'` | same | **Relaxed.** React inline `style={{}}` props compile to inline style attributes. See "Open: unsafe-inline" below. |
| `img-src` | `'self' https: data: cached-image:` | same | `cached-image:` is a custom protocol for locally-cached remote email images. |
| `font-src` | `'self'` | same | Fonts bundled locally; no external CDNs. |
| `connect-src` | `'self' https://api.anthropic.com` | `+ http://localhost:5173 ws://localhost:5173` | Anthropic is the only external service the app talks to. Ollama is localhost and handled separately (see below). |
| `worker-src` | `'self' blob:` | same | `@xenova/transformers` spawns ONNX workers from blob URLs for local embeddings. |
| `frame-src` | `'none'` | same | App never embeds iframes. |
| `frame-ancestors` | `'none'` | same | Blocks clickjacking by preventing the window from being embedded anywhere. |
| `form-action` | `'self'` | same | Phishing defence — forms can only POST to the app itself. |
| `object-src` | `'none'` | same | Blocks Flash / applets. |
| `base-uri` | `'self'` | same | Blocks `<base href>` injection. |

## Ollama traffic

When the user selects Ollama as their LLM provider, the classifier
makes requests to `http://localhost:11434`. This is **not** covered
by the CSP's `connect-src` today — Ollama calls happen from the main
process (`fetch()` in `src/adapters/ollama/`), which is unaffected by
renderer-side CSP. No CSP rule needs relaxing for Ollama.

## Open: why `'unsafe-inline'` is still on style-src

React 18's inline `style={{}}` props emit inline style attributes, and
DOMPurify-sanitised email HTML occasionally does the same. The standard
workarounds are:

- **Nonces**: would require generating a CSP nonce per response *and*
  threading it through every inline-style call site. Not feasible
  incrementally without a Babel transform.
- **Hashes**: every style variation generates a new hash; the CSP would
  need to enumerate thousands of them.
- **Migrate to Tailwind-only**: hundreds of components, multi-week lift.

**Current compensating controls:**
1. DOMPurify is applied to every email body before rendering.
2. `src/renderer/components/EmailViewer.tsx` explicitly strips CSS
   attack vectors on rendered email HTML: `expression()`,
   `javascript:`, `behavior:`, `-moz-binding:`.
3. `frame-ancestors 'none'` blocks the clickjacking class of attack
   that would typically be the multiplier for inline-style abuse.

## Testing

`npm run dev:electron` then open DevTools → **Security** tab and confirm
the CSP report matches the expected directive set. There is no automated
CSP test today — one using a headless Electron harness is tracked under
a follow-up to #105.

## History

- 2026-04-21 — #100: added `frame-ancestors`, `form-action`,
  `worker-src`, explicit `cached-image:` scheme in the meta tag.
  Documented the remaining `'unsafe-inline'` tradeoff.
