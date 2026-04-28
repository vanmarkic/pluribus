/**
 * Eval runner (#92). Pure function over a classifier + dataset.
 *
 * I/O (history append, stdout) lives in run-eval.ts; this module stays
 * side-effect-free so it can be unit-tested.
 */

import type { TriageFolder } from '../core/domain';
import { computeReport } from './metrics';
import type { EvalClassifier, EvalEntry, EvalResult, EvalReport } from './types';

const ALL_FOLDERS: TriageFolder[] = [
  'INBOX', 'Planning', 'Review',
  'Paper-Trail/Invoices', 'Paper-Trail/Admin', 'Paper-Trail/Travel',
  'Feed', 'Social', 'Promotions', 'Archive',
];

/**
 * Run the classifier over every entry, collect results, and compute the
 * full report. Individual classifier errors are captured per-entry and
 * count as incorrect — one flaky request shouldn't nuke the whole eval.
 */
export async function runEval(
  classifier: EvalClassifier,
  dataset: EvalEntry[],
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<EvalReport> {
  const results: EvalResult[] = [];
  let done = 0;

  for (const entry of dataset) {
    try {
      const decision = await classifier.classify(entry);
      const correct = decision.folder === entry.expectedFolder;
      results.push({
        id: entry.id,
        expected: entry.expectedFolder,
        actual: decision.folder,
        confidence: decision.confidence,
        latencyMs: decision.latencyMs,
        costUsd: decision.costUsd ?? 0,
        correct,
      });
    } catch (err) {
      results.push({
        id: entry.id,
        expected: entry.expectedFolder,
        actual: 'INBOX',
        confidence: 0,
        latencyMs: 0,
        costUsd: 0,
        correct: entry.expectedFolder === 'INBOX',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    done++;
    options.onProgress?.(done, dataset.length);
  }

  return computeReport(results, classifier.label, ALL_FOLDERS);
}
