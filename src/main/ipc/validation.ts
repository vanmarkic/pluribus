/**
 * Shared validation helpers and utilities for IPC handlers
 */

// ==========================================
// Rate Limiting
// ==========================================

const rateLimiters = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(handler: string, maxPerMinute: number): void {
  const now = Date.now();
  const limiter = rateLimiters.get(handler);

  if (!limiter || now > limiter.resetAt) {
    rateLimiters.set(handler, { count: 1, resetAt: now + 60000 });
    return;
  }

  if (limiter.count >= maxPerMinute) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  limiter.count++;
}

// ==========================================
// Input Validation Helpers
// ==========================================

export function assertPositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}: must be a positive integer`);
  }
  return value;
}

export function assertNonNegativeInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: must be a non-negative integer`);
  }
  return value;
}

export function assertString(value: unknown, name: string, maxLength = 1000): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}: must be a string`);
  }
  if (value.length > maxLength) {
    throw new Error(`Invalid ${name}: exceeds max length of ${maxLength}`);
  }
  return value;
}

export function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: must be a boolean`);
  }
  return value;
}

export function assertOptionalPositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return assertPositiveInt(value, name);
}

export function assertListOptions(opts: unknown): Record<string, unknown> {
  if (opts === undefined || opts === null) return {};
  if (typeof opts !== 'object') throw new Error('Invalid options: must be an object');

  const validated: Record<string, unknown> = {};
  const o = opts as Record<string, unknown>;

  if (o.accountId !== undefined) validated.accountId = assertPositiveInt(o.accountId, 'accountId');
  // tagId removed - using folders for organization (Issue #54)
  if (o.folderId !== undefined) validated.folderId = assertPositiveInt(o.folderId, 'folderId');
  if (o.folderPath !== undefined) validated.folderPath = assertString(o.folderPath, 'folderPath', 200);
  if (o.unreadOnly !== undefined) validated.unreadOnly = assertBoolean(o.unreadOnly, 'unreadOnly');
  if (o.starredOnly !== undefined) validated.starredOnly = assertBoolean(o.starredOnly, 'starredOnly');
  if (o.limit !== undefined) validated.limit = assertPositiveInt(o.limit, 'limit');
  if (o.offset !== undefined) validated.offset = assertNonNegativeInt(o.offset, 'offset');

  return validated;
}
