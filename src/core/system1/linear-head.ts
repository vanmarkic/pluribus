/**
 * Linear softmax head
 *
 * Multinomial logistic regression on a frozen feature vector (sentence
 * embedding plus a few scalar features). Pure and deterministic: the only
 * source of randomness is the seeded minibatch shuffle.
 *
 * Optimised with Adam, which copes with the very different scales of unit
 * norm embedding components (~0.05) and 0/1 scalar features without any
 * feature standardisation (there is nowhere to store the statistics).
 */

/** Small, fast, seedable PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type HeadSample = {
  x: ArrayLike<number>;
  /** Class index in [0, classes). */
  y: number;
  /** Loss weight, default 1 (gold labels get more). */
  weight?: number;
};

export type TrainHeadOptions = {
  classes: number;
  inputDim: number;
  epochs?: number;
  lr?: number;
  l2?: number;
  batchSize?: number;
  seed: number;
};

const DEFAULT_EPOCHS = 60;
const DEFAULT_LR = 0.05;
const DEFAULT_L2 = 1e-4;
const DEFAULT_BATCH = 32;

const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;

// Early stopping keeps the nightly job cheap and the weights modest: stop once
// the training loss is essentially zero or has stopped improving.
const MIN_EPOCHS = 5;
const STOP_LOSS = 0.01;
const STOP_RELATIVE_IMPROVEMENT = 1e-3;

/** Numerically stable softmax, in place over `logits`. */
function softmaxInPlace(logits: Float64Array | number[]): void {
  let max = -Infinity;
  for (let k = 0; k < logits.length; k++) if (logits[k]! > max) max = logits[k]!;
  if (!Number.isFinite(max)) {
    // All -Infinity / NaN: no information, fall back to uniform.
    const uniform = 1 / Math.max(1, logits.length);
    for (let k = 0; k < logits.length; k++) logits[k] = uniform;
    return;
  }
  let total = 0;
  for (let k = 0; k < logits.length; k++) {
    const e = Math.exp(logits[k]! - max);
    logits[k] = e;
    total += e;
  }
  for (let k = 0; k < logits.length; k++) logits[k] = logits[k]! / total;
}

/**
 * Class probabilities for one input.
 * Throws when the matrix, bias and input dimensions do not agree.
 */
export function predictProba(
  W: readonly (readonly number[])[],
  b: readonly number[],
  x: ArrayLike<number>,
): number[] {
  if (b.length !== W.length) {
    throw new Error(`Dimension mismatch: ${W.length} weight rows but ${b.length} biases`);
  }
  const logits: number[] = new Array<number>(W.length);
  for (let k = 0; k < W.length; k++) {
    const row = W[k]!;
    if (row.length !== x.length) {
      throw new Error(`Dimension mismatch: weights expect ${row.length} inputs, got ${x.length}`);
    }
    let z = b[k]!;
    for (let j = 0; j < row.length; j++) z += row[j]! * x[j]!;
    logits[k] = z;
  }
  softmaxInPlace(logits);
  return logits;
}

function shuffleInPlace(order: Uint32Array, rng: () => number): void {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
}

/**
 * Fit a multinomial logistic regression with minibatch Adam.
 * Weights start at zero (the loss is convex), so the result depends only on
 * the data, the options and the seed.
 */
export function trainHead(
  samples: readonly HeadSample[],
  opts: TrainHeadOptions,
): { W: number[][]; b: number[] } {
  const { classes: K, inputDim: D } = opts;
  if (!Number.isInteger(K) || K < 1) {
    throw new Error(`classes must be a positive integer, got ${K}`);
  }
  if (!Number.isInteger(D) || D < 1) {
    throw new Error(`inputDim must be a positive integer, got ${D}`);
  }
  const epochs = opts.epochs ?? DEFAULT_EPOCHS;
  const lr = opts.lr ?? DEFAULT_LR;
  const l2 = opts.l2 ?? DEFAULT_L2;
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH));

  const n = samples.length;
  const X = new Float64Array(n * D);
  const y = new Uint32Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    if (s.x.length !== D) {
      throw new Error(`Dimension mismatch: sample ${i} has ${s.x.length} inputs, expected ${D}`);
    }
    if (!Number.isInteger(s.y) || s.y < 0 || s.y >= K) {
      throw new Error(`Invalid label ${s.y} for sample ${i}: expected an integer in [0, ${K})`);
    }
    const weight = s.weight ?? 1;
    if (!(weight >= 0) || !Number.isFinite(weight)) {
      throw new Error(`Invalid weight ${weight} for sample ${i}`);
    }
    for (let j = 0; j < D; j++) X[i * D + j] = s.x[j]!;
    y[i] = s.y;
    w[i] = weight;
  }

  const W = new Float64Array(K * D);
  const b = new Float64Array(K);

  if (n > 0) {
    const mW = new Float64Array(K * D);
    const vW = new Float64Array(K * D);
    const mb = new Float64Array(K);
    const vb = new Float64Array(K);
    const gW = new Float64Array(K * D);
    const gb = new Float64Array(K);
    const p = new Float64Array(K);

    const rng = mulberry32(opts.seed);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;

    let step = 0;
    let previousLoss = Infinity;
    for (let epoch = 0; epoch < epochs; epoch++) {
      shuffleInPlace(order, rng);
      let lossSum = 0;
      let lossWeight = 0;
      for (let start = 0; start < n; start += batchSize) {
        const end = Math.min(n, start + batchSize);

        let weightSum = 0;
        for (let t = start; t < end; t++) weightSum += w[order[t]!]!;
        if (weightSum <= 0) continue;

        gW.fill(0);
        gb.fill(0);
        for (let t = start; t < end; t++) {
          const i = order[t]!;
          const base = i * D;
          for (let k = 0; k < K; k++) {
            let z = b[k]!;
            const row = k * D;
            for (let j = 0; j < D; j++) z += W[row + j]! * X[base + j]!;
            p[k] = z;
          }
          softmaxInPlace(p);
          lossSum -= w[i]! * Math.log(Math.max(p[y[i]!]!, 1e-300));
          lossWeight += w[i]!;
          const scale = w[i]! / weightSum;
          for (let k = 0; k < K; k++) {
            const err = (p[k]! - (k === y[i]! ? 1 : 0)) * scale;
            if (err === 0) continue;
            gb[k] = gb[k]! + err;
            const row = k * D;
            for (let j = 0; j < D; j++) gW[row + j] = gW[row + j]! + err * X[base + j]!;
          }
        }

        step += 1;
        const c1 = 1 - Math.pow(ADAM_BETA1, step);
        const c2 = 1 - Math.pow(ADAM_BETA2, step);
        for (let q = 0; q < K * D; q++) {
          const g = gW[q]! + l2 * W[q]!;
          mW[q] = ADAM_BETA1 * mW[q]! + (1 - ADAM_BETA1) * g;
          vW[q] = ADAM_BETA2 * vW[q]! + (1 - ADAM_BETA2) * g * g;
          W[q] = W[q]! - (lr * (mW[q]! / c1)) / (Math.sqrt(vW[q]! / c2) + ADAM_EPS);
        }
        for (let k = 0; k < K; k++) {
          const g = gb[k]!;
          mb[k] = ADAM_BETA1 * mb[k]! + (1 - ADAM_BETA1) * g;
          vb[k] = ADAM_BETA2 * vb[k]! + (1 - ADAM_BETA2) * g * g;
          b[k] = b[k]! - (lr * (mb[k]! / c1)) / (Math.sqrt(vb[k]! / c2) + ADAM_EPS);
        }
      }

      const loss = lossWeight > 0 ? lossSum / lossWeight : 0;
      const converged =
        loss < STOP_LOSS || previousLoss - loss < STOP_RELATIVE_IMPROVEMENT * previousLoss;
      if (epoch + 1 >= MIN_EPOCHS && converged) break;
      previousLoss = loss;
    }
  }

  const rows: number[][] = [];
  for (let k = 0; k < K; k++) rows.push(Array.from(W.subarray(k * D, (k + 1) * D)));
  return { W: rows, b: Array.from(b) };
}
