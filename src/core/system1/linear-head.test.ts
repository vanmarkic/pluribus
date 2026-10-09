import { describe, it, expect } from 'vitest';
import { mulberry32, predictProba, trainHead, type HeadSample } from './linear-head';

/** Box-Muller normal draw from a uniform RNG. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function unitVector(rng: () => number, dim: number): number[] {
  const v = Array.from({ length: dim }, () => gaussian(rng));
  const norm = Math.sqrt(v.reduce((s, a) => s + a * a, 0));
  return v.map((a) => a / norm);
}

/** Gaussian clusters around random centroids. `noise` is per-dimension std. */
function clusters(opts: {
  seed: number;
  dim: number;
  classes: number;
  perClass: number;
  scale: number;
  noise: number;
  centroidSeed?: number;
}): HeadSample[] {
  const centroidRng = mulberry32(opts.centroidSeed ?? 1234);
  const centroids = Array.from({ length: opts.classes }, () =>
    unitVector(centroidRng, opts.dim).map((a) => a * opts.scale),
  );
  const rng = mulberry32(opts.seed);
  const out: HeadSample[] = [];
  for (let y = 0; y < opts.classes; y++) {
    for (let i = 0; i < opts.perClass; i++) {
      const c = centroids[y]!;
      out.push({ x: c.map((a) => a + gaussian(rng) * opts.noise), y });
    }
  }
  return out;
}

function accuracy(model: { W: number[][]; b: number[] }, data: HeadSample[]): number {
  let right = 0;
  for (const s of data) {
    const p = predictProba(model.W, model.b, s.x);
    const arg = p.indexOf(Math.max(...p));
    if (arg === s.y) right++;
  }
  return right / data.length;
}

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });
});

describe('trainHead', () => {
  it('separates gaussian clusters (dim 16, 3 classes) with >= 95% holdout accuracy', () => {
    const base = { dim: 16, classes: 3, scale: 1, noise: 0.25 };
    const train = clusters({ ...base, seed: 1, perClass: 80 });
    const holdout = clusters({ ...base, seed: 2, perClass: 80 });

    const model = trainHead(train, { classes: 3, inputDim: 16, seed: 7 });

    expect(model.W).toHaveLength(3);
    expect(model.W.every((row) => row.length === 16)).toBe(true);
    expect(model.b).toHaveLength(3);
    expect(accuracy(model, holdout)).toBeGreaterThanOrEqual(0.95);
  });

  it('works on unit-norm 384-d vectors, the shape real sentence embeddings have', () => {
    const base = { dim: 384, classes: 4, scale: 1, noise: 0.03 };
    const train = clusters({ ...base, seed: 3, perClass: 60 });
    const holdout = clusters({ ...base, seed: 4, perClass: 60 });

    const model = trainHead(train, { classes: 4, inputDim: 384, seed: 11 });

    expect(accuracy(model, holdout)).toBeGreaterThanOrEqual(0.95);
  });

  it('is deterministic for the same seed and accepts Float32Array inputs', () => {
    const data = clusters({ seed: 5, dim: 16, classes: 3, perClass: 30, scale: 1, noise: 0.3 });
    const asFloat32 = data.map((s) => ({ ...s, x: Float32Array.from(s.x) }));
    const opts = { classes: 3, inputDim: 16, seed: 99 };

    const a = trainHead(data, opts);
    const b = trainHead(data, opts);
    expect(a).toEqual(b);

    const c = trainHead(asFloat32, opts);
    // Float32 rounding of the inputs may nudge weights, but the result must be close.
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 16; j++) {
        expect(c.W[k]![j]!).toBeCloseTo(a.W[k]![j]!, 1);
      }
    }
  });

  it('draws a different minibatch order for a different seed', () => {
    const data = clusters({ seed: 5, dim: 16, classes: 3, perClass: 30, scale: 1, noise: 0.5 });
    const a = trainHead(data, { classes: 3, inputDim: 16, seed: 1, epochs: 3 });
    const b = trainHead(data, { classes: 3, inputDim: 16, seed: 2, epochs: 3 });
    expect(a.W).not.toEqual(b.W);
  });

  it('weights samples: conflicting labels resolve towards the heavier one', () => {
    const x = [0.6, 0.8];
    const samples: HeadSample[] = [
      ...Array.from({ length: 10 }, () => ({ x, y: 0, weight: 1 })),
      ...Array.from({ length: 10 }, () => ({ x, y: 1, weight: 3 })),
    ];
    const model = trainHead(samples, { classes: 2, inputDim: 2, seed: 3 });
    const p = predictProba(model.W, model.b, x);
    expect(p[1]!).toBeGreaterThan(0.6);

    const flipped = samples.map((s) => ({ ...s, weight: s.y === 0 ? 3 : 1 }));
    const model2 = trainHead(flipped, { classes: 2, inputDim: 2, seed: 3 });
    expect(predictProba(model2.W, model2.b, x)[0]!).toBeGreaterThan(0.6);
  });

  it('returns finite weights for tiny, degenerate and empty data', () => {
    const empty = trainHead([], { classes: 3, inputDim: 4, seed: 1 });
    expect(empty.W).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(empty.b).toEqual([0, 0, 0]);

    const oneClass = trainHead(
      Array.from({ length: 20 }, () => ({ x: [1, 0], y: 1 })),
      { classes: 2, inputDim: 2, seed: 1 },
    );
    expect(oneClass.W.flat().every(Number.isFinite)).toBe(true);
    expect(oneClass.b.every(Number.isFinite)).toBe(true);
    expect(predictProba(oneClass.W, oneClass.b, [1, 0])[1]!).toBeGreaterThan(0.9);
  });

  it('rejects malformed samples and options', () => {
    const opts = { classes: 2, inputDim: 2, seed: 1 };
    expect(() => trainHead([{ x: [1, 2, 3], y: 0 }], opts)).toThrow(/dimension/i);
    expect(() => trainHead([{ x: [1, 2], y: 2 }], opts)).toThrow(/label/i);
    expect(() => trainHead([{ x: [1, 2], y: -1 }], opts)).toThrow(/label/i);
    expect(() => trainHead([{ x: [1, 2], y: 0.5 }], opts)).toThrow(/label/i);
    expect(() => trainHead([], { ...opts, classes: 0 })).toThrow();
    expect(() => trainHead([], { ...opts, inputDim: 0 })).toThrow();
  });

  it('does not mutate its input samples', () => {
    const data = clusters({ seed: 5, dim: 4, classes: 2, perClass: 10, scale: 1, noise: 0.3 });
    const snapshot = JSON.stringify(data);
    trainHead(data, { classes: 2, inputDim: 4, seed: 1 });
    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

describe('predictProba', () => {
  it('returns a probability distribution', () => {
    const p = predictProba(
      [
        [1, 0],
        [0, 1],
        [-1, -1],
      ],
      [0, 0.5, -0.5],
      [0.3, 0.7],
    );
    expect(p).toHaveLength(3);
    expect(p.reduce((s, a) => s + a, 0)).toBeCloseTo(1, 12);
    expect(p.every((a) => a > 0 && a < 1)).toBe(true);
  });

  it('is numerically stable for huge logits', () => {
    const big = predictProba(
      [
        [1000, 0],
        [0, 1000],
      ],
      [0, 0],
      [1, 0],
    );
    expect(big).toEqual([1, 0]);

    const neg = predictProba(
      [
        [-1e6, 0],
        [0, -1e6],
      ],
      [0, 0],
      [1, 1],
    );
    expect(neg.every(Number.isFinite)).toBe(true);
    expect(neg.reduce((s, a) => s + a, 0)).toBeCloseTo(1, 12);

    const tie = predictProba([[1e5], [1e5]], [0, 0], [1]);
    expect(tie[0]!).toBeCloseTo(0.5, 12);
  });

  it('accepts Float32Array input and rejects a dimension mismatch', () => {
    const W = [
      [1, 2],
      [3, 4],
    ];
    const b = [0, 0];
    expect(predictProba(W, b, Float32Array.from([0.5, 0.25]))).toEqual(
      predictProba(W, b, [0.5, 0.25]),
    );
    expect(() => predictProba(W, b, [1, 2, 3])).toThrow(/dimension/i);
    expect(() => predictProba(W, [0], [1, 2])).toThrow(/dimension/i);
  });
});
