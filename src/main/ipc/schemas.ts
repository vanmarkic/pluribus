/**
 * Zod schemas for IPC message payloads (#97).
 *
 * Migrates the three most recently added handlers (llm-calls,
 * embeddings, security-events) off handwritten assertions and onto Zod.
 * Older handlers will migrate incrementally — doing them all in one
 * commit would be a yak shave; doing none leaves a fragile boundary.
 *
 * Pattern: declare the schema once, export a parse() that throws a
 * consistent "Invalid <field>" error, and let the handler consume the
 * parsed result directly.
 */

import { z } from 'zod';
import { SYSTEM1_EMBEDDING_MODELS } from '../../core/domain';

// ────────────────────────────────────────────────────────────────────
// Shared primitives
// ────────────────────────────────────────────────────────────────────

const positiveInt = z.number().int().positive();
const severity = z.enum(['info', 'warn', 'alert']);
const isoTimestamp = z.string().refine(
  s => !Number.isNaN(new Date(s).getTime()),
  { message: 'Invalid ISO timestamp' },
);

// ────────────────────────────────────────────────────────────────────
// llmCalls:* handlers
// ────────────────────────────────────────────────────────────────────

export const LlmCallsListRecentInput = z
  .object({ limit: positiveInt.max(500).optional() })
  .optional();

export const LlmCallsGetDailyCostInput = z
  .object({ days: positiveInt.max(365).optional() })
  .optional();

// ────────────────────────────────────────────────────────────────────
// embeddings:* handlers
// ────────────────────────────────────────────────────────────────────

export const EmbeddingsBackfillInput = z
  .object({
    limit: positiveInt.max(50_000).optional(),
    accountId: positiveInt.optional(),
  })
  .optional();

// ────────────────────────────────────────────────────────────────────
// securityEvents:* handlers
// ────────────────────────────────────────────────────────────────────

export const SecurityEventsListRecentInput = z
  .object({
    limit: positiveInt.max(1000).optional(),
    eventType: z.string().max(100).optional(),
    severity: severity.optional(),
    sinceTs: isoTimestamp.optional(),
  })
  .optional();

export const SecurityEventsCountByTypeInput = z.union([z.undefined(), isoTimestamp]);

// ────────────────────────────────────────────────────────────────────
// replies:* handlers
// ────────────────────────────────────────────────────────────────────

export const ReplyEmailIdInput = positiveInt;

/** Snooze duration in hours: 1 hour .. 30 days. */
export const ReplySnoozeHoursInput = positiveInt.max(720);

export const ReplyBackfillAccountInput = positiveInt;

// ────────────────────────────────────────────────────────────────────
// config:set — digest section and llm.sendBodyExcerptsToCloud
// ────────────────────────────────────────────────────────────────────

/** 'HH:MM' local 24h. */
export const DIGEST_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Digest settings. Every field is optional so the renderer can send a partial
 * update (the handler merges it into the stored settings); unknown keys are
 * rejected so internal state such as `digestState` can never be smuggled in.
 */
export const DigestSettingsInput = z
  .strictObject({
    enabled: z.boolean(),
    time: z.string().regex(DIGEST_TIME_PATTERN, { message: 'must be HH:MM (24h)' }),
    graceHours: positiveInt.max(336),
    lookbackDays: positiveInt.max(90),
    maxItems: positiveInt.max(50),
    /** 2 = normal and above, 3 = important and above, 4 = critical only. */
    minImportance: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    emailToSelf: z.boolean(),
    showSubjects: z.boolean(),
    allowBiometricPrompt: z.boolean(),
    launchAtLogin: z.boolean(),
  })
  .partial();

export const SendBodyExcerptsToCloudInput = z.boolean();

// ────────────────────────────────────────────────────────────────────
// config:set — system1 section (on-device classifier)
// ────────────────────────────────────────────────────────────────────

/**
 * System 1 settings, as a partial update merged by the handler. The encoder
 * is an allowlist of known Xenova model ids: the id picks a cache folder and a
 * download URL, so it must never be free text.
 */
export const System1SettingsInput = z
  .strictObject({
    enabled: z.boolean(),
    embeddingModel: z.enum(SYSTEM1_EMBEDDING_MODELS),
    targetDisagreement: z.number().min(0.01).max(0.2),
    auditRate: z.number().min(0).max(0.5),
  })
  .partial();

// ────────────────────────────────────────────────────────────────────
// Helper: uniform parse with a friendly error message
// ────────────────────────────────────────────────────────────────────

export function parseInput<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : name;
    throw new Error(`Invalid ${path}: ${issue?.message ?? 'validation failed'}`);
  }
  return result.data;
}
