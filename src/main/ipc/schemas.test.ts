import { describe, it, expect } from 'vitest';
import {
  EmbeddingsBackfillInput,
  SecurityEventsListRecentInput,
  SecurityEventsCountByTypeInput,
  parseInput,
} from './schemas';

describe('parseInput', () => {
  it('returns the parsed value on success', () => {
    const result = parseInput(EmbeddingsBackfillInput, { limit: 10 }, 'opts');
    expect(result).toEqual({ limit: 10 });
  });

  it('throws an error with the zod issue path for typed failures', () => {
    expect(() =>
      parseInput(EmbeddingsBackfillInput, { limit: -1 }, 'opts'),
    ).toThrow(/Invalid limit/);
  });

  it('falls back to the arg name when zod reports a root-level issue', () => {
    expect(() =>
      parseInput(SecurityEventsCountByTypeInput, 42 as unknown, 'sinceIso'),
    ).toThrow(/Invalid/);
  });

  it('accepts undefined for optional inputs', () => {
    expect(parseInput(EmbeddingsBackfillInput, undefined, 'opts')).toBeUndefined();
    expect(parseInput(SecurityEventsListRecentInput, undefined, 'opts')).toBeUndefined();
  });
});

describe('EmbeddingsBackfillInput', () => {
  it('rejects non-positive limits', () => {
    expect(() => parseInput(EmbeddingsBackfillInput, { limit: 0 }, 'opts')).toThrow();
  });

  it('rejects limits > 50_000', () => {
    expect(() => parseInput(EmbeddingsBackfillInput, { limit: 50_001 }, 'opts')).toThrow();
  });

  it('accepts accountId + limit', () => {
    const result = parseInput(EmbeddingsBackfillInput, { limit: 100, accountId: 7 }, 'opts');
    expect(result).toEqual({ limit: 100, accountId: 7 });
  });
});

describe('SecurityEventsListRecentInput', () => {
  it('restricts severity to the allowlist', () => {
    expect(() =>
      parseInput(SecurityEventsListRecentInput, { severity: 'critical' }, 'opts'),
    ).toThrow();
    const ok = parseInput(SecurityEventsListRecentInput, { severity: 'alert' }, 'opts');
    expect(ok).toEqual({ severity: 'alert' });
  });

  it('rejects malformed sinceTs', () => {
    expect(() =>
      parseInput(SecurityEventsListRecentInput, { sinceTs: 'not a date' }, 'opts'),
    ).toThrow();
  });
});

describe('SecurityEventsCountByTypeInput', () => {
  it('accepts undefined (no filter)', () => {
    expect(parseInput(SecurityEventsCountByTypeInput, undefined, 's')).toBeUndefined();
  });

  it('accepts a valid ISO string', () => {
    const iso = '2026-04-21T12:00:00Z';
    expect(parseInput(SecurityEventsCountByTypeInput, iso, 's')).toBe(iso);
  });

  it('rejects a number', () => {
    expect(() => parseInput(SecurityEventsCountByTypeInput, 42, 's')).toThrow();
  });
});
