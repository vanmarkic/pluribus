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
