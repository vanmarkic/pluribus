import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { selectThreshold } from './threshold';
import { clopperPearsonUpper } from './bounds';

type Point = { confidence: number; correct: boolean };

/** Evenly spaced confidences in (lo, hi]. */
function spread(count: number, lo: number, hi: number, correct: boolean): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    confidence: lo + ((i + 1) / count) * (hi - lo),
    correct,
  }));
}

/** Independent reference: try every distinct confidence as a threshold. */
function bruteForce(points: Point[], epsilon: number, alpha: number, minAccepted: number) {
  const values = [...new Set(points.map((p) => p.confidence))];
  let best: { threshold: number; accepted: number } | null = null;
  for (const tau of values) {
    const accepted = points.filter((p) => p.confidence >= tau);
    const wrong = accepted.filter((p) => !p.correct).length;
    if (accepted.length < minAccepted) continue;
    if (clopperPearsonUpper(wrong, accepted.length, alpha) > epsilon) continue;
    if (!best || accepted.length > best.accepted)
      best = { threshold: tau, accepted: accepted.length };
  }
  return best;
}

describe('selectThreshold', () => {
  it('returns null when there are fewer points than minAccepted', () => {
    const points = spread(29, 0.5, 1, true);
    expect(selectThreshold(points, { epsilon: 0.2 })).toBeNull();
    expect(selectThreshold(points, { epsilon: 0.2, minAccepted: 29 })).not.toBeNull();
  });

  it('returns null when no prefix meets the risk bound', () => {
    // 30 points with 10 errors everywhere: bound is far above 5%.
    const points = Array.from({ length: 60 }, (_, i) => ({
      confidence: 1 - i / 100,
      correct: i % 3 !== 0,
    }));
    expect(selectThreshold(points, { epsilon: 0.05 })).toBeNull();
  });

  it('returns null for an empty set', () => {
    expect(selectThreshold([], { epsilon: 0.05 })).toBeNull();
  });

  it('gives high coverage for a perfectly separated set', () => {
    const points = [...spread(180, 0.6, 1, true), ...spread(20, 0, 0.3, false)];
    const result = selectThreshold(points, { epsilon: 0.05 });
    const expected = bruteForce(points, 0.05, 0.05, 30);
    expect(result).not.toBeNull();
    expect(result!.coverage).toBeGreaterThanOrEqual(0.9);
    expect(result!.accepted).toBe(expected!.accepted);
    expect(result!.threshold).toBe(expected!.threshold);
    expect(result!.upperBound).toBeLessThanOrEqual(0.05);
    expect(result!.upperBound).toBeCloseTo(
      clopperPearsonUpper(result!.disagreements, result!.accepted),
      12,
    );

    // Without junk the whole confident block is accepted with a clean record.
    const clean = selectThreshold(spread(180, 0.6, 1, true), { epsilon: 0.05 });
    expect(clean).toMatchObject({ accepted: 180, disagreements: 0, coverage: 1 });
    // Threshold is the lowest accepted confidence, so `confidence >= threshold` accepts it.
    expect(clean!.threshold).toBeCloseTo(0.6 + (1 / 180) * 0.4, 12);
  });

  it('never accepts a group whose observed error rate already exceeds epsilon', () => {
    const points = [...spread(100, 0.7, 1, true), ...spread(100, 0, 0.7, false)];
    const result = selectThreshold(points, { epsilon: 0.05 });
    expect(result!.accepted).toBeLessThan(110);
    expect(result!.disagreements / result!.accepted).toBeLessThanOrEqual(0.05);
  });

  it('picks the largest accepted set whose upper bound stays within epsilon', () => {
    // 300 confident correct answers, then a band of mixed ones, then junk.
    const mixed: Point[] = spread(100, 0.4, 0.7, true).map((p, i) =>
      i % 25 === 0 ? { ...p, correct: false } : p,
    );
    const points = [...spread(300, 0.7, 1, true), ...mixed, ...spread(50, 0, 0.4, false)];
    const eps = 0.05;
    const result = selectThreshold(points, { epsilon: eps });
    const expected = bruteForce(points, eps, 0.05, 30);

    expect(result).not.toBeNull();
    expect(result!.accepted).toBe(expected!.accepted);
    expect(result!.threshold).toBe(expected!.threshold);
    expect(result!.upperBound).toBeLessThanOrEqual(eps);
    expect(result!.accepted).toBeGreaterThan(300);
    expect(result!.accepted).toBeLessThan(points.length);
    expect(result!.disagreements / result!.accepted).toBeLessThanOrEqual(eps);
    expect(result!.coverage).toBeCloseTo(result!.accepted / points.length, 12);
  });

  it('accepts tied confidences together (the threshold is a cut, not a rank)', () => {
    const points: Point[] = [
      ...Array.from({ length: 100 }, () => ({ confidence: 0.9, correct: true })),
      ...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.8, correct: i !== 0 })),
    ];
    const result = selectThreshold(points, { epsilon: 0.05, minAccepted: 10 });
    // The 0.8 group has one error: bound for 1/110 is ~0.04... check against brute force.
    const expected = bruteForce(points, 0.05, 0.05, 10);
    expect(result?.threshold).toBe(expected?.threshold);
    expect(result?.accepted).toBe(expected?.accepted);
    // Never splits the tie group: accepted is 100 or 110.
    expect([100, 110]).toContain(result!.accepted);
  });

  it('honours alpha and minAccepted', () => {
    const points = spread(80, 0.5, 1, true);
    expect(selectThreshold(points, { epsilon: 0.05, minAccepted: 80 })).not.toBeNull();
    expect(selectThreshold(points, { epsilon: 0.05, minAccepted: 81 })).toBeNull();
    // 80 clean points: bound(alpha=.05) = 0.0364 passes, bound(alpha=1e-6) is far looser.
    expect(selectThreshold(points, { epsilon: 0.05, alpha: 0.05 })).not.toBeNull();
    expect(selectThreshold(points, { epsilon: 0.05, alpha: 1e-6 })).toBeNull();
  });

  it('ignores non-finite confidences and does not mutate its input', () => {
    const points: Point[] = [
      ...spread(100, 0.5, 1, true),
      { confidence: Number.NaN, correct: false },
      { confidence: Number.POSITIVE_INFINITY, correct: false },
    ];
    const snapshot = points.map((p) => ({ ...p }));
    const result = selectThreshold(points, { epsilon: 0.05 });
    expect(result?.accepted).toBe(100);
    expect(points.map((p) => p.confidence)).toEqual(snapshot.map((p) => p.confidence));
  });

  it('property: agrees with an exhaustive search', () => {
    const pointArb = fc.record({
      confidence: fc.integer({ min: 0, max: 20 }).map((v) => v / 20),
      correct: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 0, maxLength: 220 }),
        fc.constantFrom(0.05, 0.1, 0.2),
        (raw, eps) => {
          // Bias towards "correct" so non-null results actually occur.
          const points = raw.map((p, i) =>
            i % 4 === 0 ? p : { ...p, correct: p.correct || i % 3 !== 0 },
          );
          const got = selectThreshold(points, { epsilon: eps, minAccepted: 10 });
          const want = bruteForce(points, eps, 0.05, 10);
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
