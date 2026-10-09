import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { entropyConfidence } from './confidence';

/** Temperature-sharpen a distribution: p_i ∝ q_i^t (entropy falls as t grows). */
function sharpen(q: number[], t: number): number[] {
  const powered = q.map((v) => Math.pow(v, t));
  const total = powered.reduce((s, a) => s + a, 0);
  return powered.map((a) => a / total);
}

describe('entropyConfidence', () => {
  it('is 1 for a one-hot distribution', () => {
    expect(entropyConfidence([1, 0])).toBe(1);
    expect(entropyConfidence([0, 0, 1, 0])).toBe(1);
  });

  it('is 0 for the uniform distribution', () => {
    expect(entropyConfidence([0.5, 0.5])).toBeCloseTo(0, 12);
    expect(entropyConfidence(new Array(10).fill(0.1))).toBeCloseTo(0, 12);
  });

  it('is 1 for a single-class distribution (nothing to be unsure about)', () => {
    expect(entropyConfidence([1])).toBe(1);
    expect(entropyConfidence([])).toBe(1);
  });

  it('matches a hand-computed binary value', () => {
    // H(0.9, 0.1) = 0.3251 nats; 1 - 0.3251 / ln 2 = 0.5310
    expect(entropyConfidence([0.9, 0.1])).toBeCloseTo(0.531, 3);
  });

  it('stays within [0, 1] and tolerates zeros and rounding noise', () => {
    expect(entropyConfidence([0.5, 0.5, 0])).toBeGreaterThanOrEqual(0);
    expect(entropyConfidence([1 + 1e-12, -1e-12])).toBeLessThanOrEqual(1);
    expect(entropyConfidence([1 + 1e-12, -1e-12])).toBeGreaterThanOrEqual(0);
  });

  it('is monotone: a sharper distribution is never less confident', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), { minLength: 2, maxLength: 10 }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        (q, t, extra) => {
          const base = sharpen(q, t);
          const sharper = sharpen(q, t + extra);
          const a = entropyConfidence(base);
          const b = entropyConfidence(sharper);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(1);
          expect(b).toBeGreaterThanOrEqual(a - 1e-9);
        },
      ),
      { numRuns: 200, seed: 20261009 },
    );
  });
});
