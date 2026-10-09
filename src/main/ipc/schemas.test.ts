import { describe, it, expect } from 'vitest';
import {
  EmbeddingsBackfillInput,
  SecurityEventsListRecentInput,
  SecurityEventsCountByTypeInput,
  ReplyEmailIdInput,
  ReplySnoozeHoursInput,
  ReplyBackfillAccountInput,
  DigestSettingsInput,
  SendBodyExcerptsToCloudInput,
  System1SettingsInput,
  parseInput,
} from './schemas';
import { DEFAULT_SYSTEM1_SETTINGS, SYSTEM1_EMBEDDING_MODELS } from '../../core/domain';

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

describe('ReplyEmailIdInput / ReplyBackfillAccountInput', () => {
  it('accepts positive integers', () => {
    expect(parseInput(ReplyEmailIdInput, 42, 'emailId')).toBe(42);
    expect(parseInput(ReplyBackfillAccountInput, 1, 'accountId')).toBe(1);
  });

  it('rejects zero, negatives, fractions and non-numbers', () => {
    for (const bad of [0, -3, 1.5, '7', null, undefined, {}]) {
      expect(() => parseInput(ReplyEmailIdInput, bad, 'emailId')).toThrow(/Invalid/);
      expect(() => parseInput(ReplyBackfillAccountInput, bad, 'accountId')).toThrow(/Invalid/);
    }
  });
});

describe('ReplySnoozeHoursInput', () => {
  it('accepts 1..720 hours', () => {
    expect(parseInput(ReplySnoozeHoursInput, 1, 'hours')).toBe(1);
    expect(parseInput(ReplySnoozeHoursInput, 24, 'hours')).toBe(24);
    expect(parseInput(ReplySnoozeHoursInput, 720, 'hours')).toBe(720);
  });

  it('rejects out-of-range and non-integer hours', () => {
    for (const bad of [0, -1, 721, 2.5, 'soon']) {
      expect(() => parseInput(ReplySnoozeHoursInput, bad, 'hours')).toThrow(/Invalid/);
    }
  });
});

describe('DigestSettingsInput', () => {
  const valid = {
    enabled: true,
    time: '09:00',
    graceHours: 24,
    lookbackDays: 14,
    maxItems: 10,
    emailToSelf: true,
    showSubjects: false,
    allowBiometricPrompt: false,
  };

  it('accepts a full settings object', () => {
    expect(parseInput(DigestSettingsInput, valid, 'digest')).toEqual(valid);
  });

  it('accepts a partial update', () => {
    expect(parseInput(DigestSettingsInput, { time: '23:59' }, 'digest')).toEqual({
      time: '23:59',
    });
    expect(parseInput(DigestSettingsInput, {}, 'digest')).toEqual({});
  });

  it('validates the HH:MM time format', () => {
    for (const ok of ['00:00', '09:05', '19:30', '23:59']) {
      expect(parseInput(DigestSettingsInput, { time: ok }, 'digest')).toEqual({ time: ok });
    }
    for (const bad of ['24:00', '9:00', '09:60', '0900', '09:00:00', '', 'noon']) {
      expect(() => parseInput(DigestSettingsInput, { time: bad }, 'digest')).toThrow(/time/);
    }
  });

  it('bounds numeric fields', () => {
    const edge: Array<[string, number, number]> = [
      ['graceHours', 1, 336],
      ['lookbackDays', 1, 90],
      ['maxItems', 1, 50],
    ];
    for (const [key, min, max] of edge) {
      expect(parseInput(DigestSettingsInput, { [key]: min }, 'digest')).toEqual({ [key]: min });
      expect(parseInput(DigestSettingsInput, { [key]: max }, 'digest')).toEqual({ [key]: max });
      expect(() => parseInput(DigestSettingsInput, { [key]: min - 1 }, 'digest')).toThrow(
        new RegExp(key),
      );
      expect(() => parseInput(DigestSettingsInput, { [key]: max + 1 }, 'digest')).toThrow(
        new RegExp(key),
      );
      expect(() => parseInput(DigestSettingsInput, { [key]: 1.5 }, 'digest')).toThrow(
        new RegExp(key),
      );
    }
  });

  it('requires real booleans', () => {
    for (const key of ['enabled', 'emailToSelf', 'showSubjects', 'allowBiometricPrompt']) {
      expect(() => parseInput(DigestSettingsInput, { [key]: 'yes' }, 'digest')).toThrow(
        new RegExp(key),
      );
      expect(() => parseInput(DigestSettingsInput, { [key]: 1 }, 'digest')).toThrow(
        new RegExp(key),
      );
    }
  });

  it('rejects unknown keys such as digestState internals', () => {
    expect(() =>
      parseInput(DigestSettingsInput, { ...valid, lastRunDate: '2026-01-01' }, 'digest'),
    ).toThrow(/Invalid/);
    expect(() =>
      parseInput(DigestSettingsInput, { pendingEmailAccountIds: [1] }, 'digest'),
    ).toThrow(/Invalid/);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'digest', 7, []]) {
      expect(() => parseInput(DigestSettingsInput, bad, 'digest')).toThrow(/Invalid/);
    }
  });
});

describe('SendBodyExcerptsToCloudInput', () => {
  it('accepts booleans only', () => {
    expect(parseInput(SendBodyExcerptsToCloudInput, true, 'flag')).toBe(true);
    expect(parseInput(SendBodyExcerptsToCloudInput, false, 'flag')).toBe(false);
    for (const bad of ['true', 1, 0, null, undefined]) {
      expect(() => parseInput(SendBodyExcerptsToCloudInput, bad, 'flag')).toThrow(/Invalid/);
    }
  });
});

describe('System1SettingsInput', () => {
  it('accepts the full default settings and any partial update', () => {
    expect(parseInput(System1SettingsInput, DEFAULT_SYSTEM1_SETTINGS, 'system1')).toEqual(
      DEFAULT_SYSTEM1_SETTINGS,
    );
    expect(parseInput(System1SettingsInput, { enabled: false }, 'system1')).toEqual({
      enabled: false,
    });
    expect(parseInput(System1SettingsInput, {}, 'system1')).toEqual({});
  });

  it('only accepts the known encoder models', () => {
    for (const model of SYSTEM1_EMBEDDING_MODELS) {
      expect(parseInput(System1SettingsInput, { embeddingModel: model }, 's')).toEqual({
        embeddingModel: model,
      });
    }
    for (const bad of [
      'Xenova/some-other-model',
      '../../etc/passwd',
      'http://evil.example/model',
      '',
      7,
      null,
    ]) {
      expect(() => parseInput(System1SettingsInput, { embeddingModel: bad }, 's')).toThrow(
        /embeddingModel/,
      );
    }
  });

  it('bounds targetDisagreement to 0.01..0.2', () => {
    for (const ok of [0.01, 0.05, 0.2]) {
      expect(parseInput(System1SettingsInput, { targetDisagreement: ok }, 's')).toEqual({
        targetDisagreement: ok,
      });
    }
    for (const bad of [0, 0.009, 0.21, 1, -0.05, NaN, '0.05', null]) {
      expect(() => parseInput(System1SettingsInput, { targetDisagreement: bad }, 's')).toThrow(
        /targetDisagreement/,
      );
    }
  });

  it('bounds auditRate to 0..0.5', () => {
    for (const ok of [0, 0.05, 0.5]) {
      expect(parseInput(System1SettingsInput, { auditRate: ok }, 's')).toEqual({ auditRate: ok });
    }
    for (const bad of [-0.01, 0.51, 1, NaN, '0.1', null]) {
      expect(() => parseInput(System1SettingsInput, { auditRate: bad }, 's')).toThrow(/auditRate/);
    }
  });

  it('requires a real boolean for enabled', () => {
    for (const bad of ['yes', 1, 0, null]) {
      expect(() => parseInput(System1SettingsInput, { enabled: bad }, 's')).toThrow(/enabled/);
    }
  });

  it('rejects unknown keys and non-objects', () => {
    expect(() => parseInput(System1SettingsInput, { enabled: true, cacheDir: '/tmp' }, 's')).toThrow(
      /Invalid/,
    );
    for (const bad of [null, undefined, 'system1', 7, []]) {
      expect(() => parseInput(System1SettingsInput, bad, 's')).toThrow(/Invalid/);
    }
  });
});
