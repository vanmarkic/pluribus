/**
 * Confidence threshold selection with bounded risk.
 *
 * Given held-out points (the head's confidence, and whether its answer agreed
 * with the label), choose the threshold that accepts the MOST answers while
 * the Clopper-Pearson upper bound on the disagreement rate among accepted
 * answers stays at or below epsilon. If no threshold qualifies the head must
 * not arm: precision first, coverage second.
 */

import { clopperPearsonUpper } from './bounds';

export type ThresholdPoint = { confidence: number; correct: boolean };

export type ThresholdSelection = {
  /** Accept an answer when `confidence >= threshold`. */
  threshold: number;
  /** accepted / total (finite) points. */
  coverage: number;
  accepted: number;
  disagreements: number;
  /** Clopper-Pearson upper bound on the disagreement rate among accepted points. */
  upperBound: number;
};

export type ThresholdOptions = {
  /** Largest acceptable (bounded) disagreement rate. */
  epsilon: number;
  alpha?: number;
  /** Fewest accepted points for the bound to count. Default 30. */
  minAccepted?: number;
};

export function selectThreshold(
  points: readonly ThresholdPoint[],
  opts: ThresholdOptions,
): ThresholdSelection | null {
  const alpha = opts.alpha ?? 0.05;
  const minAccepted = opts.minAccepted ?? 30;

  const sorted = points
    .filter((p) => Number.isFinite(p.confidence))
    .sort((a, b) => b.confidence - a.confidence);
  const total = sorted.length;

  let best: ThresholdSelection | null = null;
  let wrong = 0;
  let i = 0;
  while (i < total) {
    // Ties are accepted together: the threshold is a cut on confidence, not a rank.
    const confidence = sorted[i]!.confidence;
    let j = i;
    while (j < total && sorted[j]!.confidence === confidence) {
      if (!sorted[j]!.correct) wrong += 1;
      j += 1;
    }
    const accepted = j;
    i = j;

    if (accepted < minAccepted) continue;
    // The upper bound is never below the observed rate: skip the exact bound when hopeless.
    if (wrong / accepted > opts.epsilon) continue;
    const upperBound = clopperPearsonUpper(wrong, accepted, alpha);
    if (upperBound > opts.epsilon) continue;

    // Later prefixes accept strictly more, so the last qualifying one has the most coverage.
    best = {
      threshold: confidence,
      coverage: accepted / total,
      accepted,
      disagreements: wrong,
      upperBound,
    };
  }
  return best;
}
