/**
 * Finite-sample bound on an error rate.
 *
 * System 1 only answers when we can say, with 1 - alpha confidence, that its
 * disagreement with the teacher among accepted answers is at most epsilon.
 * The Clopper-Pearson interval is exact (never anti-conservative), which is
 * what we want when a wrong local answer silently files someone's mail.
 */

/** log P(X = i) for X ~ Binomial(n, p), accumulated term by term. */
function logCdfTerms(k: number, n: number, p: number): number[] {
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  const terms: number[] = [];
  let logChoose = 0; // log C(n, 0)
  for (let i = 0; i <= k; i++) {
    terms.push(logChoose + i * lp + (n - i) * lq);
    logChoose += Math.log((n - i) / (i + 1));
  }
  return terms;
}

/** P(X <= k) for X ~ Binomial(n, p), computed in log space. */
function binomialCdf(k: number, n: number, p: number): number {
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const terms = logCdfTerms(k, n, p);
  let max = -Infinity;
  for (const t of terms) if (t > max) max = t;
  let sum = 0;
  for (const t of terms) sum += Math.exp(t - max);
  return Math.min(1, Math.exp(max) * sum);
}

/**
 * One-sided upper confidence bound for a binomial proportion after observing
 * `k` events in `n` trials: the p for which P(X <= k | p) = alpha.
 *
 * `n = 0` gives 1 (no evidence); `k >= n` gives 1.
 */
export function clopperPearsonUpper(k: number, n: number, alpha = 0.05): number {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
  if (!(n > 0)) return 1;
  const events = Math.max(0, Math.floor(k));
  if (events >= n) return 1;
  // Closed form: (1 - p)^n = alpha.
  if (events === 0) return -Math.expm1(Math.log(alpha) / n);

  // binomialCdf(k, n, p) decreases in p, from 1 at p = 0 to 0 at p = 1.
  let lo = events / n;
  let hi = 1;
  for (let i = 0; i < 100 && hi - lo > 1e-13; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(events, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
