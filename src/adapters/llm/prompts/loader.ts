/**
 * Prompt loader + deterministic A/B picker (#91).
 *
 * The loader exposes named, versioned prompts so adapters don't import
 * prompt files directly. chooseVersion() shards traffic on a stable hash
 * of the email id, which means:
 *   - Every classify call for the same email consistently sees the same
 *     version (no split-brain if the email is reclassified).
 *   - The split is independent of wall-clock time, so comparing two eval
 *     runs is apples-to-apples.
 */

import { buildV3, CLASSIFY_V3_VERSION } from './classify.v3';
import { buildV4, CLASSIFY_V4_VERSION } from './classify.v4';

export type PromptVersion = 'v3' | 'v4';

export type PromptSpec = {
  version: PromptVersion;
  /** Semver-ish string recorded in llm_calls.prompt_version. */
  label: string;
  text: string;
};

// Cache the built strings — buildVN() concatenates at every call, and the
// prompt body shows up in cache_control hashes, so we want a single stable
// copy per process.
const CACHE: Record<PromptVersion, PromptSpec> = {
  v3: { version: 'v3', label: CLASSIFY_V3_VERSION, text: buildV3() },
  v4: { version: 'v4', label: CLASSIFY_V4_VERSION, text: buildV4() },
};

export const PRODUCTION_VERSION: PromptVersion = 'v3';

export function loadPrompt(version: PromptVersion): PromptSpec {
  return CACHE[version];
}

export function listVersions(): PromptVersion[] {
  return Object.keys(CACHE) as PromptVersion[];
}

/**
 * Deterministic modulo hash. FNV-1a-ish, enough for a 0..99 bucket — we
 * don't need crypto strength here, just evenness across ids.
 */
function bucketFor(emailId: number): number {
  // Use absolute value so negative ids (shouldn't happen but) can't go
  // negative through the modulo.
  const n = Math.abs(Math.trunc(emailId)) || 0;
  // Cheap mixing so sequential ids don't all land in the same bucket.
  const mixed = ((n * 2654435761) >>> 0) % 100;
  return mixed;
}

/**
 * Pick a version for a given email. `challengerPercent` is an integer in
 * 0..100 — the fraction of traffic that routes to the challenger. When 0,
 * always returns production; when 100, always returns challenger.
 *
 * challenger defaults to the "next" version after production.
 */
export function chooseVersion(
  emailId: number,
  challengerPercent: number,
  challenger: PromptVersion = 'v4',
  production: PromptVersion = PRODUCTION_VERSION,
): PromptVersion {
  const pct = Math.max(0, Math.min(100, Math.floor(challengerPercent)));
  if (pct === 0) return production;
  if (pct === 100) return challenger;
  return bucketFor(emailId) < pct ? challenger : production;
}

/**
 * Read CI/env config for the A/B experiment. Centralised here so the
 * container stays thin and the eval harness can opt out cleanly.
 */
export function challengerPercentFromEnv(): number {
  const raw = process.env.PROMPT_CHALLENGER_PERCENT;
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
