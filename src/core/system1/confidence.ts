/**
 * Confidence of a predicted distribution.
 *
 * `1 - H(p) / ln K`: 1 for a one-hot distribution, 0 for the uniform one, and
 * monotone in between (a sharper distribution is never less confident). The
 * normalisation by ln K makes heads with different numbers of classes
 * comparable; the per-head threshold is calibrated on held-out data anyway.
 */
export function entropyConfidence(p: readonly number[]): number {
  const K = p.length;
  if (K <= 1) return 1;
  let entropy = 0;
  for (const value of p) {
    if (value > 0) entropy -= value * Math.log(value);
  }
  const confidence = 1 - entropy / Math.log(K);
  if (Number.isNaN(confidence)) return 0;
  return Math.min(1, Math.max(0, confidence));
}
