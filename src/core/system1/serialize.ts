/**
 * Head weights as stored and loaded.
 *
 * Weights are persisted as JSON, which turns NaN and Infinity into null.
 * Everything here therefore insists on finite numbers, and a loaded head is
 * re-checked against the live input dimension before it may answer.
 */

import type { HeadWeights, Question } from './types';

export type HeadWeightsInput = {
  questionId: string;
  kind: Question['kind'];
  labels: readonly string[];
  W: readonly (readonly number[])[];
  b: readonly number[];
  featureNames: readonly string[];
};

/** First structural problem with `weights`, or null when they are well formed. */
function describeProblem(weights: HeadWeights): string | null {
  const { labels, W, b, inputDim } = weights;
  if (!Array.isArray(labels) || !Array.isArray(W) || !Array.isArray(b)) {
    return 'labels, W and b must be arrays';
  }
  if (!Number.isInteger(inputDim) || inputDim < 0) return `invalid inputDim ${String(inputDim)}`;
  if (W.length !== labels.length) {
    return `${W.length} weight rows for ${labels.length} labels`;
  }
  if (b.length !== labels.length) {
    return `${b.length} biases for ${labels.length} labels`;
  }
  for (let k = 0; k < W.length; k++) {
    const row = W[k];
    if (!Array.isArray(row) || row.length !== inputDim) {
      return `weight row ${k} has length ${Array.isArray(row) ? row.length : 'n/a'}, expected ${inputDim}`;
    }
    for (const value of row) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `weight row ${k} contains a non-finite value`;
      }
    }
  }
  for (const value of b) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 'biases contain a non-finite value';
    }
  }
  return null;
}

/**
 * Build storable weights from a trained head. Copies its inputs, derives
 * `inputDim` from the matrix, and refuses malformed or non-finite values.
 */
export function toHeadWeights(input: HeadWeightsInput): HeadWeights {
  const weights: HeadWeights = {
    questionId: input.questionId,
    kind: input.kind,
    labels: [...input.labels],
    inputDim: input.W[0]?.length ?? 0,
    W: input.W.map((row) => [...row]),
    b: [...input.b],
    featureNames: [...input.featureNames],
  };
  const problem = describeProblem(weights);
  if (problem) throw new Error(`Invalid head weights: ${problem}`);
  return weights;
}

/** Throws unless `weights` are well formed and accept inputs of length `inputDim`. */
export function assertCompatible(weights: HeadWeights, inputDim: number): void {
  if (weights.inputDim !== inputDim) {
    throw new Error(`Input dimension mismatch: head expects ${weights.inputDim}, got ${inputDim}`);
  }
  const problem = describeProblem(weights);
  if (problem) throw new Error(`Invalid head weights: ${problem}`);
}

export function isCompatible(weights: HeadWeights, inputDim: number): boolean {
  try {
    assertCompatible(weights, inputDim);
    return true;
  } catch {
    return false;
  }
}
