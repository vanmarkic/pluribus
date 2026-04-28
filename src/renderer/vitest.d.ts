/**
 * Renderer-side vitest ambient types. Hoists the jest-dom matcher
 * declarations into the global Assertion interface so `.toBeInTheDocument`
 * and friends type-check inside .test.tsx files without each one having
 * to import jest-dom explicitly.
 *
 * The runtime-side import lives in src/renderer/__tests__/setup.ts.
 */

/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest';
