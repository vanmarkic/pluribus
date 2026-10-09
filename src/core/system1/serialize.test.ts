import { describe, it, expect } from 'vitest';
import { assertCompatible, isCompatible, toHeadWeights } from './serialize';
import { predictProba, trainHead } from './linear-head';
import type { HeadWeights } from './types';

function trained(): HeadWeights {
  // Two classes in 3 dimensions: class 1 when x0 is large.
  const samples = Array.from({ length: 60 }, (_, i) => {
    const y = i % 2;
    return { x: [y ? 1 : -1, ((i * 7) % 5) / 5, 0.25], y };
  });
  const { W, b } = trainHead(samples, { classes: 2, inputDim: 3, seed: 4 });
  return toHeadWeights({
    questionId: 'needsReply',
    kind: 'noul',
    labels: ['false', 'true'],
    W,
    b,
    featureNames: ['f1', 'f2'],
  });
}

describe('toHeadWeights', () => {
  it('derives inputDim from W and keeps the metadata', () => {
    const w = trained();
    expect(w.inputDim).toBe(3);
    expect(w.questionId).toBe('needsReply');
    expect(w.kind).toBe('noul');
    expect(w.labels).toEqual(['false', 'true']);
    expect(w.featureNames).toEqual(['f1', 'f2']);
  });

  it('copies its inputs so later mutation does not leak in', () => {
    const W = [
      [1, 2],
      [3, 4],
    ];
    const w = toHeadWeights({
      questionId: 'q',
      kind: 'noul',
      labels: ['false', 'true'],
      W,
      b: [0, 0],
      featureNames: [],
    });
    W[0]![0] = 99;
    expect(w.W[0]![0]).toBe(1);
  });

  it('survives a JSON round trip with identical predictions', () => {
    const w = trained();
    const back = JSON.parse(JSON.stringify(w)) as HeadWeights;
    expect(back).toEqual(w);
    for (const x of [
      [1, 0.2, 0.25],
      [-1, 0.8, 0.25],
      [0.01, 0, 0],
    ]) {
      expect(predictProba(back.W, back.b, x)).toEqual(predictProba(w.W, w.b, x));
    }
    expect(() => assertCompatible(back, 3)).not.toThrow();
  });

  it('refuses non-finite values (they would silently become null in JSON)', () => {
    const base = {
      questionId: 'q',
      kind: 'noul' as const,
      labels: ['false', 'true'],
      featureNames: [],
    };
    expect(() => toHeadWeights({ ...base, W: [[Number.NaN], [0]], b: [0, 0] })).toThrow(/finite/i);
    expect(() =>
      toHeadWeights({ ...base, W: [[0], [0]], b: [Number.POSITIVE_INFINITY, 0] }),
    ).toThrow(/finite/i);
  });

  it('refuses ragged or mislabelled matrices', () => {
    const base = { questionId: 'q', kind: 'noul' as const, featureNames: [] };
    expect(() =>
      toHeadWeights({ ...base, labels: ['false', 'true'], W: [[1, 2], [3]], b: [0, 0] }),
    ).toThrow();
    expect(() =>
      toHeadWeights({ ...base, labels: ['false', 'true'], W: [[1, 2]], b: [0, 0] }),
    ).toThrow();
    expect(() =>
      toHeadWeights({ ...base, labels: ['false', 'true'], W: [[1], [2]], b: [0] }),
    ).toThrow();
  });
});

describe('assertCompatible', () => {
  it('passes for a matching input dimension', () => {
    expect(() => assertCompatible(trained(), 3)).not.toThrow();
    expect(isCompatible(trained(), 3)).toBe(true);
  });

  it('throws on an input dimension mismatch', () => {
    expect(() => assertCompatible(trained(), 4)).toThrow(/dimension/i);
    expect(isCompatible(trained(), 4)).toBe(false);
  });

  it('throws on corrupted weights read back from storage', () => {
    const w = trained();
    expect(() => assertCompatible({ ...w, W: [w.W[0]!] }, 3)).toThrow();
    expect(() => assertCompatible({ ...w, b: [0] }, 3)).toThrow();
    expect(() =>
      assertCompatible(
        {
          ...w,
          W: [
            [1, 2],
            [3, 4],
          ],
        },
        3,
      ),
    ).toThrow();
    expect(() => assertCompatible({ ...w, W: [[1, 2, Number.NaN], w.W[1]!] }, 3)).toThrow(
      /finite/i,
    );
    // A null from JSON.stringify(NaN) must not pass either.
    const nulled = JSON.parse(JSON.stringify({ ...w, b: [Number.NaN, 0] })) as HeadWeights;
    expect(() => assertCompatible(nulled, 3)).toThrow();
    expect(isCompatible(nulled, 3)).toBe(false);
  });
});
