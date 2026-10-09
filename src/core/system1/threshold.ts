/**
 * Confidence threshold selection with bounded risk.
 *
 * Given held-out points (the head's confidence, and whether its answer agreed
 * with the label), choose the threshold that accepts the MOST answers while
 * the Clopper-Pearson upper bound on the disagreement rate among accepted
 * answers stays at or below epsilon. If no threshold qualifies the head must
 * not arm: precision first, coverage second.
 *
 * Only a FIXED grid of candidate thresholds is tested, each at alpha / K
 * (Bonferroni over the K grid values). Scanning every observed confidence
 * and keeping the best one would test as many hypotheses as there are points
 * and quietly weaken the "at most epsilon with probability 1 - alpha" claim;
 * with the correction the claim holds for whichever grid value is chosen.
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
  /** Candidate thresholds (confidence cut-offs). Default THRESHOLD_GRID. */
  grid?: readonly number[];
};

/** 1 - H/Hmax is compressed for binary heads (p=0.9 gives ~0.53), so the grid starts low. */
export const THRESHOLD_GRID: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export function selectThreshold(
  points: readonly ThresholdPoint[],
  opts: ThresholdOptions,
): ThresholdSelection | null {
  const grid = [...new Set(opts.grid ?? THRESHOLD_GRID)].filter(Number.isFinite);
  if (grid.length === 0) return null;
  // Bonferroni: every grid value is a separate test of "risk <= epsilon".
  const alpha = (opts.alpha ?? 0.05) / grid.length;
  const minAccepted = opts.minAccepted ?? 30;

  const finite = points.filter((p) => Number.isFinite(p.confidence));
  const total = finite.length;

  let best: ThresholdSelection | null = null;
  for (const threshold of grid) {
    const accepted = finite.filter((p) => p.confidence >= threshold);
    if (accepted.length < minAccepted) continue;
    const wrong = accepted.filter((p) => !p.correct).length;
    // The upper bound is never below the observed rate: skip the exact bound when hopeless.
    if (wrong / accepted.length > opts.epsilon) continue;
    const upperBound = clopperPearsonUpper(wrong, accepted.length, alpha);
    if (upperBound > opts.epsilon) continue;

    // Most coverage wins; on a tie keep the stricter (higher) threshold.
    if (
      !best ||
      accepted.length > best.accepted ||
      (accepted.length === best.accepted && threshold > best.threshold)
    ) {
      best = {
        threshold,
        coverage: accepted.length / total,
        accepted: accepted.length,
        disagreements: wrong,
        upperBound,
      };
    }
  }
  return best;
}
