/**
 * Eval CLI entry point (#92).
 *
 * Usage:
 *   npm run eval                        # rule-based stub, no API cost
 *   ANTHROPIC_API_KEY=... npm run eval  # real Anthropic (Haiku 4.5)
 *   EVAL_MODEL=claude-sonnet-4-6 ...    # override model
 *   EVAL_MIN_ACCURACY=0.75 ...          # CI gate; exit 1 if below
 *
 * Writes each run as one line to evals/history.jsonl and prints a human
 * summary to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DATASET } from './dataset';
import { runEval } from './runner';
import { formatReport } from './metrics';
import { STUB_CLASSIFIER } from './stub-classifier';
import type { EvalClassifier } from './types';

// Resolve project root from dist/evals/ so history ends up next to source.
// (dist/evals -> dist -> <project>)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const HISTORY_PATH = path.join(PROJECT_ROOT, 'evals', 'history.jsonl');

async function pickClassifier(): Promise<EvalClassifier> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[eval] ANTHROPIC_API_KEY not set — using rule-based stub classifier.');
    return STUB_CLASSIFIER;
  }
  // Lazy-import so the stub path doesn't pay for the SDK load or require
  // the SDK to be resolvable in the CI image.
  const { createAnthropicEvalClassifier } = await import('./anthropic-classifier');
  const model = process.env.EVAL_MODEL ?? 'claude-haiku-4-5-20251001';
  console.log(`[eval] Using Anthropic classifier (model: ${model}).`);
  return createAnthropicEvalClassifier(apiKey, model);
}

function appendHistory(jsonLine: string): void {
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.appendFileSync(HISTORY_PATH, jsonLine + '\n', 'utf8');
  } catch (err) {
    console.warn('[eval] Could not persist history:', err);
  }
}

async function main() {
  const classifier = await pickClassifier();
  console.log(`[eval] Running ${DATASET.length} entries against ${classifier.label}…`);

  const startedAt = Date.now();
  const report = await runEval(classifier, DATASET, {
    onProgress: (done, total) => {
      // Simple one-line ticker; CI logs stay readable.
      if (done % 5 === 0 || done === total) {
        process.stdout.write(`  ${done}/${total}\r`);
      }
    },
  });
  const wallMs = Date.now() - startedAt;

  process.stdout.write('\n\n');
  console.log(formatReport(report));
  console.log(`\nWall time: ${(wallMs / 1000).toFixed(1)}s`);

  appendHistory(JSON.stringify(report));

  const minAccuracy = parseFloat(process.env.EVAL_MIN_ACCURACY ?? '');
  if (!Number.isNaN(minAccuracy) && report.accuracy < minAccuracy) {
    console.error(
      `\n[eval] FAIL — accuracy ${(report.accuracy * 100).toFixed(1)}% ` +
      `below gate ${(minAccuracy * 100).toFixed(1)}%`
    );
    process.exit(1);
  }

  const minMacroF1 = parseFloat(process.env.EVAL_MIN_MACRO_F1 ?? '');
  if (!Number.isNaN(minMacroF1) && report.macroF1 < minMacroF1) {
    console.error(
      `\n[eval] FAIL — macro-F1 ${(report.macroF1 * 100).toFixed(1)}% ` +
      `below gate ${(minMacroF1 * 100).toFixed(1)}%`
    );
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[eval] Unhandled error:', err);
  process.exit(2);
});
