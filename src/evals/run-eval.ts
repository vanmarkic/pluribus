/**
 * Eval CLI entry point (#92).
 *
 * Usage:
 *   npm run eval                        # rule-based stub, no API cost
 *   ANTHROPIC_API_KEY=... npm run eval  # real Anthropic (Haiku 4.5)
 *   EVAL_MODEL=claude-sonnet-4-6 ...    # override model
 *   EVAL_CLASSIFIER=system1 npm run eval  # on-device encoder + head, 4-fold cross-validation
 *   EVAL_EMBED_MODEL=Xenova/multilingual-e5-small ...  # encoder for EVAL_CLASSIFIER=system1
 *   EVAL_MODEL_CACHE=~/.cache/pluribus-eval-models ... # where encoder models are cached
 *   EVAL_LANG_WEIGHTS=fr:0.95,en:0.05   # language mix of the headline numbers
 *   EVAL_MIN_ACCURACY=0.75 ...          # CI gate; exit 1 if below
 *   EVAL_MIN_MACRO_F1=0.75 ...          # CI gate; exit 1 if below
 *
 * The headline accuracy / macro-F1 (and the gates) use the language-weighted
 * numbers: the real mailbox is ~95% French, so French dominates. The
 * per-language numbers are printed alongside.
 *
 * Writes each run as one line to evals/history.jsonl and prints a human
 * summary to stdout.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_SYSTEM1_SETTINGS } from '../core/domain';
import { DATASET } from './dataset';
import { runEval } from './runner';
import { formatReport, parseLangWeights } from './metrics';
import { STUB_CLASSIFIER } from './stub-classifier';
import type { System1EvalSummary } from './system1-classifier';
import type { EvalClassifier } from './types';

// Resolve project root from dist/evals/ so history ends up next to source.
// (dist/evals -> dist -> <project>)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const HISTORY_PATH = path.join(PROJECT_ROOT, 'evals', 'history.jsonl');

/** The on-device encoder + a head, scored out-of-fold (k = 4) on the dataset. */
async function createSystem1Classifier(): Promise<EvalClassifier> {
  // Lazy-import so the stub path never loads the ONNX runtime.
  const { createEmbeddingService } = await import('../adapters/embeddings');
  const { createSystem1EvalClassifier } = await import('./system1-classifier');

  const modelName = process.env.EVAL_EMBED_MODEL ?? DEFAULT_SYSTEM1_SETTINGS.embeddingModel;
  const cacheDir =
    process.env.EVAL_MODEL_CACHE ?? path.join(os.homedir(), '.cache', 'pluribus-eval-models');
  const encoder = createEmbeddingService({ modelName, cacheDir });
  console.log(
    `[eval] System 1: encoder ${modelName}, model cache ${cacheDir}` +
      (encoder.isModelCached() ? ' (offline)' : ' (first run downloads the model once)'),
  );
  console.log(`[eval] Embedding ${DATASET.length} entries, then 4-fold cross-validation…`);
  return createSystem1EvalClassifier(DATASET, {
    embed: (text) => encoder.embed(text),
    modelLabel: modelName,
  });
}

async function pickClassifier(): Promise<EvalClassifier> {
  const requested = (process.env.EVAL_CLASSIFIER ?? '').trim().toLowerCase();
  if (requested === 'system1') return createSystem1Classifier();
  if (requested === 'stub') return STUB_CLASSIFIER;
  if (requested !== '' && requested !== 'anthropic') {
    throw new Error(`Unknown EVAL_CLASSIFIER "${requested}" (use stub, anthropic or system1)`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (requested === 'anthropic') throw new Error('EVAL_CLASSIFIER=anthropic needs ANTHROPIC_API_KEY');
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

/** What production would do with these answers: arm a head (and where), or stay in shadow mode. */
function describeSystem1(summary: System1EvalSummary): string {
  const bound = `${(summary.epsilon * 100).toFixed(0)}%`;
  const s = summary.selection;
  if (!s) {
    return (
      `System 1 would NOT arm on these ${summary.heldOut} held-out answers: no confidence threshold ` +
      `keeps the 95% bound on disagreement below ${bound} (a real head needs ~110 clean ` +
      `held-out answers, i.e. ~550 labelled emails).`
    );
  }
  return (
    `System 1 would arm at confidence >= ${s.threshold}: it answers ${(s.coverage * 100).toFixed(1)}% ` +
    `of mail on-device (${s.accepted} answers, ${s.disagreements} wrong), disagreement <= ` +
    `${(s.upperBound * 100).toFixed(1)}% at 95% confidence (target ${bound}).`
  );
}

async function main() {
  const langWeights = parseLangWeights(process.env.EVAL_LANG_WEIGHTS);
  const classifier = await pickClassifier();
  console.log(`[eval] Running ${DATASET.length} entries against ${classifier.label}…`);
  const system1 = (classifier as Partial<{ summary: System1EvalSummary }>).summary;

  const startedAt = Date.now();
  const report = await runEval(classifier, DATASET, {
    langWeights,
    // For System 1 the interesting escalation rate is at the threshold it would arm with.
    ...(system1?.selection ? { escalationThreshold: system1.selection.threshold } : {}),
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
  if (system1) console.log(`\n${describeSystem1(system1)}`);
  console.log(`\nWall time: ${(wallMs / 1000).toFixed(1)}s`);

  appendHistory(JSON.stringify(report));

  // Gates apply to the headline: the language-weighted numbers (which equal
  // the plain ones when the results carry no language).
  const accuracy = report.weightedAccuracy ?? report.accuracy;
  const macroF1 = report.weightedMacroF1 ?? report.macroF1;

  const minAccuracy = parseFloat(process.env.EVAL_MIN_ACCURACY ?? '');
  if (!Number.isNaN(minAccuracy) && accuracy < minAccuracy) {
    console.error(
      `\n[eval] FAIL — weighted accuracy ${(accuracy * 100).toFixed(1)}% ` +
      `below gate ${(minAccuracy * 100).toFixed(1)}%`
    );
    process.exit(1);
  }

  const minMacroF1 = parseFloat(process.env.EVAL_MIN_MACRO_F1 ?? '');
  if (!Number.isNaN(minMacroF1) && macroF1 < minMacroF1) {
    console.error(
      `\n[eval] FAIL — weighted macro-F1 ${(macroF1 * 100).toFixed(1)}% ` +
      `below gate ${(minMacroF1 * 100).toFixed(1)}%`
    );
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[eval] Unhandled error:', err);
  process.exit(2);
});
