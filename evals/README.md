# Pluribus classifier evals

Regression harness for the email-triage classifier. See issue #92.

## Running

```bash
# Rule-based stub — no API cost, works in CI.
npm run eval

# Real Anthropic classifier (Haiku 4.5 by default).
ANTHROPIC_API_KEY=sk-... npm run eval

# Override model.
ANTHROPIC_API_KEY=sk-... EVAL_MODEL=claude-sonnet-4-6 npm run eval

# Gate in CI: fail the run if accuracy drops below a threshold.
EVAL_MIN_ACCURACY=0.75 npm run eval
EVAL_MIN_MACRO_F1=0.70 npm run eval

# On-device System 1: embed every entry with the real encoder, then 4-fold
# cross-validation of a small head (each entry is scored by a head that never saw it).
# The first run downloads the model once; later runs are offline.
EVAL_CLASSIFIER=system1 npm run eval
# Compare encoders on the same data (the default is Xenova/multilingual-e5-small).
EVAL_CLASSIFIER=system1 EVAL_EMBED_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2 npm run eval
EVAL_CLASSIFIER=system1 EVAL_MODEL_CACHE=~/models npm run eval   # default: ~/.cache/pluribus-eval-models
```

## Languages

About 95% of the real mailbox is French, so French is the majority of the
dataset and every entry carries `lang: 'fr' | 'en'`. The report prints the
per-language accuracy / macro-F1, and the **headline** (and the CI gates) use
the language-weighted numbers. Set the mix with
`EVAL_LANG_WEIGHTS=fr:0.95,en:0.05` (the default).

The report also has a confidence-aware section: expected calibration error
(10 bins), accuracy at 50% / 80% coverage, and the share of answers that would
escalate to the LLM. It only means something for a classifier with a
meaningful confidence (System 1, the LLM), not for the rule-based stub.

## Layout

| Path | Purpose |
|---|---|
| `src/evals/dataset.ts` | ~100 labelled synthetic emails (mostly French, some English) across every triage folder, plus prompt-injection stress cases. All addresses use `example.com` / invalid TLDs so the file is safe to commit. |
| `src/evals/system1-classifier.ts` | k-fold evaluation of the on-device encoder + head (`EVAL_CLASSIFIER=system1`). Takes any `embed` function, so tests use a deterministic fake. |
| `src/evals/types.ts` | `EvalEntry`, `EvalResult`, `EvalReport`, `EvalClassifier` contracts. |
| `src/evals/metrics.ts` | Precision / recall / F1 per folder, confusion matrix, p50/p95 latency, macro-F1, report diffing. |
| `src/evals/stub-classifier.ts` | Rule-based baseline. Ships the floor that any real classifier must beat. |
| `src/evals/anthropic-classifier.ts` | Stand-alone Anthropic classifier (no Electron / keychain deps) used when `ANTHROPIC_API_KEY` is set. |
| `src/evals/runner.ts` | Pure `runEval(classifier, dataset)` — unit-testable, no I/O. |
| `src/evals/run-eval.ts` | CLI entry point. Picks a classifier, writes a JSONL row per run to `evals/history.jsonl`, enforces optional gates. |
| `evals/history.jsonl` | Append-only trend log. One JSON report per run. |

## When to update the dataset

- **After a prompt-version bump**: add a challenging example that the previous
  version got wrong, so the regression shows up next time.
- **After a user correction flood**: if the production `classification_feedback`
  table shows 10+ dismissals for the same pattern, fold a sanitised version
  into the dataset.
- **Never include real user content.** All entries here must be synthetic.

## CI integration

`npm run eval` is cheap (~5s with the stub). Wire it into CI on any PR
that touches `src/adapters/llm/**` or `src/evals/dataset.ts`, and set
`EVAL_MIN_MACRO_F1` to the current baseline minus 2pp so noise doesn't
flap the check.
