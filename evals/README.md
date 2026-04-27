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
```

## Layout

| Path | Purpose |
|---|---|
| `src/evals/dataset.ts` | ~40 labelled synthetic emails across every triage folder, plus prompt-injection stress cases. All addresses use `example.com` / invalid TLDs so the file is safe to commit. |
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
