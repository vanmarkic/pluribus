/**
 * Confidence calibration via Platt scaling (#96).
 *
 * The LLM emits a raw confidence ∈ [0,1] per classification. Anecdotally
 * that number is **over-confident** — a "0.9" from the model lines up
 * with roughly 70% empirical accuracy on our labelled set. Platt scaling
 * fits a one-dimensional logistic regression on (raw, correct) pairs
 * collected from user feedback and maps raw → calibrated probability.
 *
 * Pure math — no I/O, no classifier deps. Feedback pair collection and
 * persistence happen in the triage use cases. Evaluation (ECE) happens
 * in the eval harness.
 *
 * Algorithm: gradient descent on the logistic NLL
 *   p(y=1 | r) = σ(a · r + b)
 *   loss       = −Σ [ y · log p + (1−y) · log (1−p) ]
 *
 * Typical training set: 500–5000 pairs. Small enough for full-batch GD
 * with a few thousand steps to converge in <100 ms. No external numeric
 * deps, no matrix inversion — keeps the whole thing one file and fast
 * enough to run in the background-task manager.
 */

export type FeedbackPair = {
  /** Raw confidence the classifier emitted. */
  rawConfidence: number;
  /** 1 if the user accepted (possibly with edits), 0 if dismissed. */
  correct: number;
};

export type CalibrationModel = {
  /** Slope: steeper → tighter separation between low- and high-accuracy regions. */
  a: number;
  /** Intercept. */
  b: number;
  /** Number of samples the model was fit on — useful for guarding against tiny sets. */
  fitSize: number;
};

/** Fallback identity calibration when we don't have enough data yet. */
export const IDENTITY_CALIBRATION: CalibrationModel = { a: 1, b: 0, fitSize: 0 };

function sigmoid(x: number): number {
  // Numerically stable: avoid overflow for very negative x.
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Fit a Platt scaling model on feedback pairs. Returns IDENTITY_CALIBRATION
 * when fewer than `minSamples` pairs are provided, or when every label
 * is the same class (logistic regression is degenerate there).
 */
export function fitPlattScaling(
  pairs: FeedbackPair[],
  options: { minSamples?: number; iterations?: number; learningRate?: number } = {},
): CalibrationModel {
  const minSamples = options.minSamples ?? 50;
  if (pairs.length < minSamples) return IDENTITY_CALIBRATION;

  // Degenerate label check. fitSize stays at 0 so downstream code has a
  // single 'no real fit' signal — identity is identity regardless of how
  // many samples produced it.
  const positives = pairs.filter(p => p.correct === 1).length;
  if (positives === 0 || positives === pairs.length) {
    return IDENTITY_CALIBRATION;
  }

  const iterations = options.iterations ?? 2000;
  const lr = options.learningRate ?? 0.05;

  // Platt's original paper biases the labels slightly to avoid overfit —
  // we use the ε-smoothing scheme:
  //   y_new = (N_pos + 1) / (N_pos + 2)    for positives
  //   y_new =        1   / (N_neg + 2)    for negatives
  const N = pairs.length;
  const nPos = positives;
  const nNeg = N - nPos;
  const yPos = (nPos + 1) / (nPos + 2);
  const yNeg = 1 / (nNeg + 2);

  let a = 1;
  let b = 0;

  for (let step = 0; step < iterations; step++) {
    let gradA = 0;
    let gradB = 0;
    for (const { rawConfidence: r, correct } of pairs) {
      const y = correct === 1 ? yPos : yNeg;
      const p = sigmoid(a * r + b);
      const err = p - y;
      gradA += err * r;
      gradB += err;
    }
    a -= (lr * gradA) / N;
    b -= (lr * gradB) / N;
  }

  return { a, b, fitSize: N };
}

/** Apply a calibration model to a raw confidence. An un-fit model
 * (fitSize=0) passes the raw value through unchanged — we only apply
 * the logistic transform once we actually have data. */
export function calibrateConfidence(raw: number, model: CalibrationModel): number {
  const clamped = Math.max(0, Math.min(1, raw));
  if (model.fitSize === 0) return clamped;
  const calibrated = sigmoid(model.a * clamped + model.b);
  return Math.max(0, Math.min(1, calibrated));
}

/**
 * Expected Calibration Error over K equal-width bins. Lower = better
 * calibrated. A perfect classifier has ECE=0; an uncalibrated model often
 * sits around 0.1–0.2. Reported in the cost dashboard.
 */
export function expectedCalibrationError(
  pairs: FeedbackPair[],
  options: { bins?: number; model?: CalibrationModel } = {},
): number {
  if (pairs.length === 0) return 0;
  const bins = options.bins ?? 10;
  const model = options.model ?? IDENTITY_CALIBRATION;

  const bucketCorrect = new Array(bins).fill(0);
  const bucketConf = new Array(bins).fill(0);
  const bucketCount = new Array(bins).fill(0);

  for (const pair of pairs) {
    const p = calibrateConfidence(pair.rawConfidence, model);
    const idx = Math.min(bins - 1, Math.floor(p * bins));
    bucketCorrect[idx] += pair.correct;
    bucketConf[idx] += p;
    bucketCount[idx] += 1;
  }

  let ece = 0;
  for (let i = 0; i < bins; i++) {
    if (bucketCount[i] === 0) continue;
    const avgConf = bucketConf[i] / bucketCount[i];
    const accuracy = bucketCorrect[i] / bucketCount[i];
    ece += (bucketCount[i] / pairs.length) * Math.abs(avgConf - accuracy);
  }
  return ece;
}
