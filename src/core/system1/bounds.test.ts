import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { clopperPearsonUpper } from './bounds';

/** Reference binomial CDF P(X <= k), direct summation (small n only). */
function binomCdf(k: number, n: number, p: number): number {
  let total = 0;
  let coeff = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    total += coeff * Math.pow(p, i) * Math.pow(1 - p, n - i);
    coeff = (coeff * (n - i)) / (i + 1);
  }
  return total;
}

describe('clopperPearsonUpper', () => {
  it('matches the rule-of-three style closed form when k = 0', () => {
    expect(clopperPearsonUpper(0, 60)).toBeCloseTo(0.0487, 3);
    for (const n of [1, 10, 30, 59, 200, 1000]) {
      expect(clopperPearsonUpper(0, n)).toBeCloseTo(1 - Math.pow(0.05, 1 / n), 8);
    }
  });

  it('matches exact one-sided 95% values (verified by exact binomial summation)', () => {
    // The brief quotes ~0.1043 for 5/100; the exact Clopper-Pearson value is 0.10225.
    expect(Math.abs(clopperPearsonUpper(5, 100) - 0.1043)).toBeLessThan(3e-3);
    expect(clopperPearsonUpper(5, 100)).toBeCloseTo(0.102253, 5);
    expect(clopperPearsonUpper(1, 20)).toBeCloseTo(0.216106, 5);
    expect(clopperPearsonUpper(10, 50)).toBeCloseTo(0.315596, 5);
    expect(clopperPearsonUpper(30, 20000)).toBeCloseTo(0.002034, 6);
  });

  it('satisfies its defining equation P(X <= k | p = U) = alpha', () => {
    for (const [k, n, alpha] of [
      [0, 40, 0.05],
      [3, 40, 0.05],
      [7, 120, 0.05],
      [12, 60, 0.01],
      [2, 25, 0.1],
    ] as const) {
      const upper = clopperPearsonUpper(k, n, alpha);
      expect(binomCdf(k, n, upper)).toBeCloseTo(alpha, 6);
    }
  });

  it('degenerates safely', () => {
    expect(clopperPearsonUpper(0, 0)).toBe(1);
    expect(clopperPearsonUpper(5, 0)).toBe(1);
    expect(clopperPearsonUpper(10, 10)).toBe(1);
    expect(clopperPearsonUpper(11, 10)).toBe(1);
    expect(clopperPearsonUpper(-3, 10)).toBeCloseTo(clopperPearsonUpper(0, 10), 12);
  });

  it('is a stricter bound for a smaller alpha', () => {
    expect(clopperPearsonUpper(2, 50, 0.01)).toBeGreaterThan(clopperPearsonUpper(2, 50, 0.05));
    expect(clopperPearsonUpper(2, 50, 0.05)).toBeGreaterThan(clopperPearsonUpper(2, 50, 0.2));
  });

  it('handles large n without overflow', () => {
    const u = clopperPearsonUpper(30, 20000);
    expect(Number.isFinite(u)).toBe(true);
    expect(u).toBeGreaterThan(30 / 20000);
    expect(u).toBeLessThan(0.003);
  });

  it('property: k/n <= upper <= 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, frac) => {
          const k = Math.floor(frac * n);
          const u = clopperPearsonUpper(k, n);
          expect(u).toBeGreaterThanOrEqual(k / n - 1e-9);
          expect(u).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200, seed: 20261009 },
    );
  });

  it('property: the bound increases with k and decreases with n', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 300 }), fc.integer({ min: 0, max: 298 }), (n, k0) => {
        const k = Math.min(k0, n - 2);
        expect(clopperPearsonUpper(k + 1, n)).toBeGreaterThan(clopperPearsonUpper(k, n));
        expect(clopperPearsonUpper(k, n + 1)).toBeLessThan(clopperPearsonUpper(k, n) + 1e-12);
      }),
      { numRuns: 200, seed: 20261009 },
    );
  });
});
