/**
 * Eval metrics (#92).
 *
 * Pure functions over EvalResult[] → EvalReport. No I/O.
 */

import type { EvalResult, EvalReport, PerFolderMetrics } from './types';
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

/** Compute the full EvalReport from a list of classifier results. */
export function computeReport(
  results: EvalResult[],
  classifierLabel: string,
  folders: TriageFolder[]
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
  lines.push(`  p50:       ${report.p50LatencyMs} ms`);
  lines.push(`  p95:       ${report.p95LatencyMs} ms`);
  lines.push(`  cost:      $${report.totalCostUsd.toFixed(4)}`);
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
