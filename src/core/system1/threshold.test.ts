import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { selectThreshold, THRESHOLD_GRID } from './threshold';
import { clopperPearsonUpper } from './bounds';

type Point = { confidence: number; correct: boolean };

/** Evenly spaced confidences in (lo, hi]. */
function spread(count: number, lo: number, hi: number, correct: boolean): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    confidence: lo + ((i + 1) / count) * (hi - lo),
    correct,
  }));
}

/** Independent reference: try every grid value, Bonferroni-corrected. */
function bruteForce(
  points: Point[],
  epsilon: number,
  minAccepted: number,
  grid: readonly number[] = THRESHOLD_GRID,
  alpha = 0.05,
) {
  let best: { threshold: number; accepted: number } | null = null;
  for (const tau of grid) {
    const accepted = points.filter((p) => p.confidence >= tau);
    const wrong = accepted.filter((p) => !p.correct).length;
    if (accepted.length < minAccepted) continue;
    if (clopperPearsonUpper(wrong, accepted.length, alpha / grid.length) > epsilon) continue;
    if (
      !best ||
      accepted.length > best.accepted ||
      (accepted.length === best.accepted && tau > best.threshold)
    ) {
      best = { threshold: tau, accepted: accepted.length };
    }
  }
  return best;
}

describe('selectThreshold', () => {
  it('only ever returns a value from the fixed grid', () => {
    const result = selectThreshold(spread(400, 0.05, 1, true), { epsilon: 0.05 });
    expect(result).not.toBeNull();
    expect(THRESHOLD_GRID).toContain(result!.threshold);
  });

  it('applies a Bonferroni correction over the grid', () => {
    // 100 clean points pass a single 95% test (bound 0.0295) but not one corrected
    // for 9 grid values (bound ~0.0505).
    const points = spread(100, 0.95, 1, true);
    expect(selectThreshold(points, { epsilon: 0.05, grid: [0.9] })).not.toBeNull();
    expect(selectThreshold(points, { epsilon: 0.05 })).toBeNull();
    // ~110 clean points are enough for the full grid.
    expect(selectThreshold(spread(110, 0.95, 1, true), { epsilon: 0.05 })).not.toBeNull();
  });

  it('returns null when there are fewer points than minAccepted', () => {
    const points = spread(29, 0.5, 1, true);
    expect(selectThreshold(points, { epsilon: 0.2 })).toBeNull();
    expect(selectThreshold(points, { epsilon: 0.2, minAccepted: 29 })).not.toBeNull();
  });

  it('returns null when no threshold meets the risk bound', () => {
    const points = Array.from({ length: 300 }, (_, i) => ({
      confidence: 1 - i / 300,
      correct: i % 3 !== 0,
    }));
    expect(selectThreshold(points, { epsilon: 0.05 })).toBeNull();
  });

  it('returns null for an empty set or an empty grid', () => {
    expect(selectThreshold([], { epsilon: 0.05 })).toBeNull();
    expect(selectThreshold(spread(500, 0.5, 1, true), { epsilon: 0.05, grid: [] })).toBeNull();
  });

  it('gives high coverage for a perfectly separated set', () => {
    const points = [...spread(360, 0.6, 1, true), ...spread(40, 0, 0.3, false)];
    const result = selectThreshold(points, { epsilon: 0.05 });
    const expected = bruteForce(points, 0.05, 30);
    expect(result).not.toBeNull();
    expect(result!.coverage).toBeGreaterThanOrEqual(0.9);
    expect(result!.accepted).toBe(expected!.accepted);
    expect(result!.threshold).toBe(expected!.threshold);
    expect(result!.upperBound).toBeLessThanOrEqual(0.05);
    expect(result!.upperBound).toBeCloseTo(
      clopperPearsonUpper(result!.disagreements, result!.accepted, 0.05 / THRESHOLD_GRID.length),
      12,
    );
  });

  it('prefers the stricter threshold when coverage ties', () => {
    // Every point is above 0.6, so 0.1..0.6 all accept the same set.
    const result = selectThreshold(spread(300, 0.65, 1, true), { epsilon: 0.05 });
    expect(result).toMatchObject({ threshold: 0.6, accepted: 300, disagreements: 0, coverage: 1 });
  });

  it('never accepts a band whose observed error rate already exceeds epsilon', () => {
    const points = [...spread(200, 0.7, 1, true), ...spread(200, 0, 0.7, false)];
    const result = selectThreshold(points, { epsilon: 0.05 });
    expect(result).not.toBeNull();
    expect(result!.disagreements / result!.accepted).toBeLessThanOrEqual(0.05);
  });

  it('picks the largest accepted set whose upper bound stays within epsilon', () => {
    const mixed: Point[] = spread(100, 0.4, 0.7, true).map((p, i) =>
      i % 25 === 0 ? { ...p, correct: false } : p,
    );
    const points = [...spread(400, 0.7, 1, true), ...mixed, ...spread(50, 0, 0.4, false)];
    const result = selectThreshold(points, { epsilon: 0.05 });
    const expected = bruteForce(points, 0.05, 30);
    expect(result).not.toBeNull();
    expect(result!.accepted).toBe(expected!.accepted);
    expect(result!.threshold).toBe(expected!.threshold);
    expect(result!.accepted).toBeGreaterThanOrEqual(400);
    expect(result!.accepted).toBeLessThan(points.length);
  });

  it('honours alpha and minAccepted', () => {
    const points = spread(150, 0.5, 1, true);
    expect(selectThreshold(points, { epsilon: 0.05, minAccepted: 150 })).not.toBeNull();
    expect(selectThreshold(points, { epsilon: 0.05, minAccepted: 151 })).toBeNull();
    expect(selectThreshold(points, { epsilon: 0.05, alpha: 1e-6 })).toBeNull();
  });

  it('ignores non-finite confidences and does not mutate its input', () => {
    const points: Point[] = [
      ...spread(150, 0.5, 1, true),
      { confidence: Number.NaN, correct: false },
      { confidence: Number.POSITIVE_INFINITY, correct: false },
    ];
    const snapshot = points.map((p) => p.confidence);
    const result = selectThreshold(points, { epsilon: 0.05 });
    expect(result?.accepted).toBe(150);
    expect(points.map((p) => p.confidence)).toEqual(snapshot);
  });

  it('property: agrees with an exhaustive search over the grid', () => {
    const pointArb = fc.record({
      confidence: fc.integer({ min: 0, max: 20 }).map((v) => v / 20),
      correct: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 0, maxLength: 400 }),
        fc.constantFrom(0.05, 0.1, 0.2),
        (raw, eps) => {
          // Bias towards "correct" so non-null results actually occur.
          const points = raw.map((p, i) =>
            i % 4 === 0 ? p : { ...p, correct: p.correct || i % 3 !== 0 },
          );
          const got = selectThreshold(points, { epsilon: eps, minAccepted: 10 });
          const want = bruteForce(points, eps, 10);
          if (want === null) {
            expect(got).toBeNull();
          } else {
            expect(got).not.toBeNull();
            expect(got!.accepted).toBe(want.accepted);
            expect(got!.threshold).toBe(want.threshold);
            expect(got!.upperBound).toBeLessThanOrEqual(eps);
          }
        },
      ),
      { numRuns: 150, seed: 20261009 },
    );
  });
});
