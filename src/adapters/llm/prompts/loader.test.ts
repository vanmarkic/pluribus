import { describe, it, expect, afterEach } from 'vitest';
import {
  loadPrompt,
  listVersions,
  chooseVersion,
  challengerPercentFromEnv,
  PRODUCTION_VERSION,
  type PromptVersion,
} from './loader';

describe('loadPrompt', () => {
  it('returns a PromptSpec for every listed version', () => {
    for (const v of listVersions()) {
      const spec = loadPrompt(v);
      expect(spec.version).toBe(v);
      expect(spec.label).toMatch(/^\d+\.\d+$/);
      expect(spec.text.length).toBeGreaterThan(200);
      // All prompts must preserve the anti-injection invariant.
      expect(spec.text.toLowerCase()).toContain('untrusted');
      // All prompts must request JSON-only output.
      expect(spec.text.toLowerCase()).toContain('json');
    }
  });

  it('returns the same object on repeated calls (cached)', () => {
    expect(loadPrompt('v3')).toBe(loadPrompt('v3'));
  });

  it('lists v3 as the production version by default', () => {
    expect(PRODUCTION_VERSION).toBe('v3');
  });
});

describe('chooseVersion', () => {
  it('always returns production when challengerPercent is 0', () => {
    for (let id = 0; id < 1000; id++) {
      expect(chooseVersion(id, 0)).toBe('v3');
    }
  });

  it('always returns challenger when challengerPercent is 100', () => {
    for (let id = 0; id < 1000; id++) {
      expect(chooseVersion(id, 100)).toBe('v4');
    }
  });

  it('is deterministic for the same emailId', () => {
    for (let id = 1; id < 50; id++) {
      const a = chooseVersion(id, 50);
      const b = chooseVersion(id, 50);
      expect(a).toBe(b);
    }
  });

  it('splits traffic close to the requested percentage', () => {
    const target = 25;
    let challengerHits = 0;
    const N = 10_000;
    for (let id = 0; id < N; id++) {
      if (chooseVersion(id, target) === 'v4') challengerHits++;
    }
    const ratio = challengerHits / N;
    // Should be within ±3 percentage points. Multiplicative-hash bucketing
    // isn't cryptographic, so we don't demand perfect uniformity.
    expect(ratio).toBeGreaterThan((target - 3) / 100);
    expect(ratio).toBeLessThan((target + 3) / 100);
  });

  it('accepts a custom challenger version', () => {
    // With 100%, any valid challenger is picked.
    const v: PromptVersion = 'v4';
    expect(chooseVersion(42, 100, v)).toBe(v);
  });

  it('clamps out-of-range percentages safely', () => {
    expect(chooseVersion(7, -10)).toBe('v3');
    expect(chooseVersion(7, 250)).toBe('v4');
  });
});

describe('challengerPercentFromEnv', () => {
  const KEY = 'PROMPT_CHALLENGER_PERCENT';
  const origEnv = process.env[KEY];

  afterEach(() => {
    if (origEnv === undefined) delete process.env[KEY];
    else process.env[KEY] = origEnv;
  });

  it('returns 0 when the env var is unset', () => {
    delete process.env[KEY];
    expect(challengerPercentFromEnv()).toBe(0);
  });

  it('parses integer values', () => {
    process.env[KEY] = '15';
    expect(challengerPercentFromEnv()).toBe(15);
  });

  it('clamps to 0..100', () => {
    process.env[KEY] = '150';
    expect(challengerPercentFromEnv()).toBe(100);
    process.env[KEY] = '-5';
    expect(challengerPercentFromEnv()).toBe(0);
  });

  it('returns 0 on non-numeric input', () => {
    process.env[KEY] = 'tuesday';
    expect(challengerPercentFromEnv()).toBe(0);
  });
});
