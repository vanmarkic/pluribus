import { describe, it, expect } from 'vitest';
import {
  fitPlattScaling,
  calibrateConfidence,
  expectedCalibrationError,
  IDENTITY_CALIBRATION,
  type FeedbackPair,
} from './calibration';

function syntheticPairs(trueSlope: number, trueIntercept: number, n: number): FeedbackPair[] {
  // Build a dataset where P(correct|raw) really is σ(trueSlope*raw + trueIntercept),
  // using a deterministic hash so the test is reproducible.
  const out: FeedbackPair[] = [];
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    const raw = rand();
    const p = 1 / (1 + Math.exp(-(trueSlope * raw + trueIntercept)));
    out.push({ rawConfidence: raw, correct: rand() < p ? 1 : 0 });
  }
  return out;
}

describe('fitPlattScaling', () => {
  it('returns IDENTITY_CALIBRATION when below minSamples', () => {
    const pairs: FeedbackPair[] = Array.from({ length: 10 }, (_, i) => ({
      rawConfidence: i / 10,
      correct: i % 2,
    }));
    expect(fitPlattScaling(pairs)).toBe(IDENTITY_CALIBRATION);
  });

  it('returns IDENTITY_CALIBRATION when every sample is the same class', () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({ rawConfidence: i / 100, correct: 1 }));
    const model = fitPlattScaling(pairs);
    expect(model).toBe(IDENTITY_CALIBRATION);
  });

  it('recovers a known logistic on synthetic data', () => {
    const pairs = syntheticPairs(6, -3, 2000);
    const model = fitPlattScaling(pairs, { iterations: 3000, learningRate: 0.1 });
    // We don't demand the exact slope/intercept — gradient descent on
    // 2000 noisy samples doesn't converge there. We demand that the
    // calibrated probabilities track the ground-truth probabilities.
    for (const raw of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const expected = 1 / (1 + Math.exp(-(6 * raw - 3)));
      const got = calibrateConfidence(raw, model);
      expect(Math.abs(got - expected)).toBeLessThan(0.1);
    }
  });

  it('reduces ECE compared to the uncalibrated model', () => {
    const pairs = syntheticPairs(3, -1.5, 1500);
    const uncalECE = expectedCalibrationError(pairs);
    const fitted = fitPlattScaling(pairs, { iterations: 3000, learningRate: 0.1 });
    const calECE = expectedCalibrationError(pairs, { model: fitted });
    expect(calECE).toBeLessThan(uncalECE);
  });
});

describe('calibrateConfidence', () => {
  it('is the identity under IDENTITY_CALIBRATION (clamped at boundaries)', () => {
    // sigmoid(raw) ≠ raw in general — "identity" here means "no calibration
    // applied", which is the logistic with a=1,b=0. We only guarantee the
    // output stays monotonic and in [0,1].
    expect(calibrateConfidence(0, IDENTITY_CALIBRATION)).toBeGreaterThanOrEqual(0);
    expect(calibrateConfidence(1, IDENTITY_CALIBRATION)).toBeLessThanOrEqual(1);
    expect(calibrateConfidence(0.5, IDENTITY_CALIBRATION)).toBeGreaterThan(
      calibrateConfidence(0.1, IDENTITY_CALIBRATION),
    );
  });

  it('clamps raw inputs outside [0,1]', () => {
    const m = { a: 5, b: -2, fitSize: 100 };
    expect(calibrateConfidence(-1, m)).toBeGreaterThanOrEqual(0);
    expect(calibrateConfidence(2, m)).toBeLessThanOrEqual(1);
  });
});

describe('expectedCalibrationError', () => {
  it('is 0 on perfectly calibrated data', () => {
    // Every pair has raw=1.0 and always correct → ECE≈0 in a single bin.
    const pairs = Array.from({ length: 100 }, () => ({ rawConfidence: 1, correct: 1 }));
    expect(expectedCalibrationError(pairs)).toBeLessThan(0.05);
  });

  it('is > 0 when the classifier is over-confident', () => {
    // Classifier always says "0.99" but is actually only right half the time.
    const pairs = Array.from({ length: 100 }, (_, i) => ({
      rawConfidence: 0.99,
      correct: i % 2,
    }));
    expect(expectedCalibrationError(pairs)).toBeGreaterThan(0.4);
  });

  it('handles an empty pair list without crashing', () => {
    expect(expectedCalibrationError([])).toBe(0);
  });
});
