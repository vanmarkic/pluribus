/**
 * Eval metrics (#92).
 *
 * Pure functions over EvalResult[] → EvalReport. No I/O.
 */

import type {
  EvalResult,
  EvalReport,
  LanguageMetrics,
  PerFolderMetrics,
  SelectiveMetrics,
} from './types';
import type { TriageFolder } from '../core/domain';

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = Math.min(sortedAsc.length - 1, Math.floor(clamped * sortedAsc.length));
  return sortedAsc[idx] ?? 0;
}

function safeDiv(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

// ============================================
// Language mix
// ============================================

/** The user's mail: about 95% French, 5% English. */
export const DEFAULT_LANG_WEIGHTS: Readonly<Record<string, number>> = { fr: 0.95, en: 0.05 };

/**
 * Parse EVAL_LANG_WEIGHTS ("fr:0.95,en:0.05") into weights that sum to 1.
 * Empty or missing input gives the default mix.
 */
export function parseLangWeights(spec: string | undefined): Record<string, number> {
  if (spec === undefined || spec.trim() === '') return { ...DEFAULT_LANG_WEIGHTS };

  const invalid = (why: string): Error =>
    new Error(`Invalid EVAL_LANG_WEIGHTS "${spec}": ${why} (expected e.g. fr:0.95,en:0.05)`);

  const weights: Record<string, number> = {};
  for (const part of spec.split(',')) {
    const [rawLang, rawWeight, ...rest] = part.split(':');
    const lang = rawLang?.trim().toLowerCase() ?? '';
    const weight = Number(rawWeight?.trim() ?? '');
    if (rest.length > 0 || lang === '' || rawWeight === undefined || rawWeight.trim() === '') {
      throw invalid(`cannot read "${part.trim()}"`);
    }
    if (!Number.isFinite(weight) || weight < 0) throw invalid(`"${part.trim()}" is not a weight`);
    if (lang in weights) throw invalid(`"${lang}" appears twice`);
    weights[lang] = weight;
  }
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  if (total <= 0) throw invalid('the weights are all zero');

  return Object.fromEntries(Object.entries(weights).map(([lang, w]) => [lang, w / total]));
}

// ============================================
// Selective prediction (confidence-aware) metrics
// ============================================

type ConfidencePoint = { confidence: number; correct: boolean };

/**
 * Accuracy on the most confident `coverage` share of answers (rounded up to
 * a whole answer). 0 for no answers or zero coverage.
 */
export function accuracyAtCoverage(points: ConfidencePoint[], coverage: number): number {
  if (points.length === 0 || !(coverage > 0)) return 0;
  const keep = Math.min(points.length, Math.max(1, Math.ceil(Math.min(1, coverage) * points.length)));
  // Array.prototype.sort is stable, so equal confidences keep their input order.
  const ranked = [...points].sort((a, b) => b.confidence - a.confidence).slice(0, keep);
  return safeDiv(ranked.filter((p) => p.correct).length, ranked.length);
}

/** Share of answers whose confidence is below `threshold` (they would escalate to System 2). */
export function escalationRate(points: ConfidencePoint[], threshold: number): number {
  return safeDiv(points.filter((p) => p.confidence < threshold).length, points.length);
}

/**
 * Expected calibration error: over `bins` equal-width confidence bins, the
 * answer-weighted mean of |accuracy - mean confidence|. 0 = perfectly calibrated.
 */
export function expectedCalibrationError(points: ConfidencePoint[], bins = 10): number {
  if (points.length === 0) return 0;
  const count = new Array<number>(bins).fill(0);
  const right = new Array<number>(bins).fill(0);
  const confidence = new Array<number>(bins).fill(0);

  for (const p of points) {
    const c = Math.max(0, Math.min(1, p.confidence));
    const bin = Math.min(bins - 1, Math.floor(c * bins));
    count[bin] = (count[bin] ?? 0) + 1;
    right[bin] = (right[bin] ?? 0) + (p.correct ? 1 : 0);
    confidence[bin] = (confidence[bin] ?? 0) + c;
  }

  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const n = count[b] ?? 0;
    if (n === 0) continue;
    const accuracy = (right[b] ?? 0) / n;
    const meanConfidence = (confidence[b] ?? 0) / n;
    ece += (n / points.length) * Math.abs(accuracy - meanConfidence);
  }
  return ece;
}

// ============================================
// Report
// ============================================

export type ComputeReportOptions = {
  /** Language mix for the weighted headline; default {@link DEFAULT_LANG_WEIGHTS}. */
  langWeights?: Record<string, number>;
  /** Confidence below which an answer would escalate. Default 0.7. */
  escalationThreshold?: number;
};

function macroF1Of(results: EvalResult[], folders: TriageFolder[]): number {
  const f1s: number[] = [];
  for (const folder of folders) {
    const support = results.filter((r) => r.expected === folder).length;
    if (support === 0) continue;
    const tp = results.filter((r) => r.expected === folder && r.actual === folder).length;
    const fp = results.filter((r) => r.expected !== folder && r.actual === folder).length;
    const fn = support - tp;
    const precision = safeDiv(tp, tp + fp);
    const recall = safeDiv(tp, tp + fn);
    f1s.push(safeDiv(2 * precision * recall, precision + recall));
  }
  return safeDiv(
    f1s.reduce((s, f) => s + f, 0),
    f1s.length,
  );
}

/** Compute the full EvalReport from a list of classifier results. */
export function computeReport(
  results: EvalResult[],
  classifierLabel: string,
  folders: TriageFolder[],
  options: ComputeReportOptions = {},
): EvalReport {
  const total = results.length;
  const correct = results.filter(r => r.correct).length;
  const accuracy = safeDiv(correct, total);

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50LatencyMs = percentile(latencies, 0.5);
  const p95LatencyMs = percentile(latencies, 0.95);
  const totalCostUsd = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);

  // Build confusion matrix.
  const confusion: Record<string, Record<string, number>> = {};
  for (const f of folders) {
    confusion[f] = Object.fromEntries(folders.map(x => [x, 0]));
  }
  for (const r of results) {
    const row = confusion[r.expected] ?? Object.fromEntries(folders.map(x => [x, 0]));
    confusion[r.expected] = row;
    row[r.actual] = (row[r.actual] ?? 0) + 1;
  }

  // Per-folder precision / recall / F1.
  const byFolder: Record<string, PerFolderMetrics> = {};
  for (const folder of folders) {
    const tp = results.filter(r => r.expected === folder && r.actual === folder).length;
    const fp = results.filter(r => r.expected !== folder && r.actual === folder).length;
    const fn = results.filter(r => r.expected === folder && r.actual !== folder).length;
    const support = results.filter(r => r.expected === folder).length;
    const precision = safeDiv(tp, tp + fp);
    const recall = safeDiv(tp, tp + fn);
    const f1 = safeDiv(2 * precision * recall, precision + recall);
    byFolder[folder] = { tp, fp, fn, precision, recall, f1, support };
  }

  // Macro-F1: average over folders that actually appear in ground truth.
  const foldersWithSupport = Object.values(byFolder).filter(m => m.support > 0);
  const macroF1 = safeDiv(
    foldersWithSupport.reduce((s, m) => s + m.f1, 0),
    foldersWithSupport.length
  );

  // Per-language slices, and the headline averaged with the user's language mix.
  const byLanguage: Record<string, LanguageMetrics> = {};
  for (const lang of new Set(results.flatMap((r) => (r.lang ? [r.lang] : [])))) {
    const slice = results.filter((r) => r.lang === lang);
    const sliceCorrect = slice.filter((r) => r.correct).length;
    byLanguage[lang] = {
      total: slice.length,
      correct: sliceCorrect,
      accuracy: safeDiv(sliceCorrect, slice.length),
      macroF1: macroF1Of(slice, folders),
    };
  }
  const requested = options.langWeights ?? DEFAULT_LANG_WEIGHTS;
  const weighted = Object.keys(byLanguage)
    .map((lang) => [lang, requested[lang] ?? 0] as const)
    .filter(([, w]) => w > 0);
  const weightSum = weighted.reduce((s, [, w]) => s + w, 0);
  const langWeights: Record<string, number> = {};
  let weightedAccuracy = accuracy;
  let weightedMacroF1 = macroF1;
  if (weightSum > 0) {
    weightedAccuracy = 0;
    weightedMacroF1 = 0;
    for (const [lang, w] of weighted) {
      const share = w / weightSum;
      langWeights[lang] = share;
      weightedAccuracy += share * (byLanguage[lang]?.accuracy ?? 0);
      weightedMacroF1 += share * (byLanguage[lang]?.macroF1 ?? 0);
    }
  }

  // Confidence-aware view (meaningful for System 1 and the LLM).
  const escalationThreshold = options.escalationThreshold ?? 0.7;
  const points: ConfidencePoint[] = results.map((r) => ({
    confidence: r.confidence,
    correct: r.correct,
  }));
  const selective: SelectiveMetrics = {
    ece: expectedCalibrationError(points),
    accuracyAtCoverage: {
      '0.5': accuracyAtCoverage(points, 0.5),
      '0.8': accuracyAtCoverage(points, 0.8),
    },
    escalationRate: escalationRate(points, escalationThreshold),
    escalationThreshold,
  };

  return {
    runAt: new Date().toISOString(),
    classifier: classifierLabel,
    total,
    correct,
    accuracy,
    p50LatencyMs,
    p95LatencyMs,
    totalCostUsd,
    byFolder,
    confusion,
    macroF1,
    byLanguage,
    langWeights,
    weightedAccuracy,
    weightedMacroF1,
    selective,
  };
}

/**
 * Pretty-print a report for humans. Width-limited so CI logs don't wrap badly.
 */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Eval report — ${report.classifier}`);
  lines.push(`  runAt:     ${report.runAt}`);
  lines.push(`  total:     ${report.total}`);
  lines.push(`  correct:   ${report.correct}`);
  lines.push(`  accuracy:  ${(report.accuracy * 100).toFixed(1)}%`);
  lines.push(`  macro-F1:  ${(report.macroF1 * 100).toFixed(1)}%`);
  if (report.weightedAccuracy !== undefined && report.weightedMacroF1 !== undefined) {
    const mix = Object.entries(report.langWeights ?? {})
      .map(([lang, w]) => `${lang} ${(w * 100).toFixed(0)}%`)
      .join(', ');
    lines.push(`  weighted accuracy: ${(report.weightedAccuracy * 100).toFixed(1)}%  (headline; mix ${mix || 'n/a'})`);
    lines.push(`  weighted macro-F1: ${(report.weightedMacroF1 * 100).toFixed(1)}%  (headline)`);
  }
  lines.push(`  p50:       ${report.p50LatencyMs} ms`);
  lines.push(`  p95:       ${report.p95LatencyMs} ms`);
  lines.push(`  cost:      $${report.totalCostUsd.toFixed(4)}`);
  if (report.byLanguage && Object.keys(report.byLanguage).length > 0) {
    lines.push('');
    lines.push('Per language:');
    lines.push('  lang   entries  accuracy  macro-F1');
    lines.push('  ─────  ───────  ────────  ────────');
    for (const [lang, m] of Object.entries(report.byLanguage)) {
      lines.push(
        `  ${lang.padEnd(5)}  ${String(m.total).padStart(7)}  ${`${(m.accuracy * 100).toFixed(1)}%`.padStart(8)}  ${`${(m.macroF1 * 100).toFixed(1)}%`.padStart(8)}`,
      );
    }
  }
  if (report.selective) {
    const s = report.selective;
    lines.push('');
    lines.push('Selective prediction (confidence-aware):');
    lines.push(`  ECE (10 bins):            ${s.ece.toFixed(3)}`);
    for (const [coverage, acc] of Object.entries(s.accuracyAtCoverage)) {
      lines.push(`  accuracy @ ${(Number(coverage) * 100).toFixed(0)}% coverage:  ${(acc * 100).toFixed(1)}%`);
    }
    lines.push(
      `  escalation rate (< ${s.escalationThreshold}):  ${(s.escalationRate * 100).toFixed(1)}%`,
    );
  }
  lines.push('');
  lines.push('Per folder:');
  lines.push('  folder                         P       R       F1      support');
  lines.push('  ─────────────────────────────  ──────  ──────  ──────  ───────');
  for (const [folder, m] of Object.entries(report.byFolder)) {
    if (m.support === 0 && m.fp === 0) continue;
    lines.push(
      `  ${folder.padEnd(29)}  ${(m.precision * 100).toFixed(1).padStart(5)}%  ${(m.recall * 100).toFixed(1).padStart(5)}%  ${(m.f1 * 100).toFixed(1).padStart(5)}%  ${String(m.support).padStart(7)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Diff two reports. Returns accuracy + macro-F1 deltas so CI can gate merges.
 */
export function diffReports(prev: EvalReport, next: EvalReport): {
  accuracyDelta: number;
  macroF1Delta: number;
  costDelta: number;
  p95Delta: number;
} {
  return {
    accuracyDelta: next.accuracy - prev.accuracy,
    macroF1Delta: next.macroF1 - prev.macroF1,
    costDelta: next.totalCostUsd - prev.totalCostUsd,
    p95Delta: next.p95LatencyMs - prev.p95LatencyMs,
  };
}
