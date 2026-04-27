import { describe, it, expect, vi } from 'vitest';
import { runEval } from './runner';
import { STUB_CLASSIFIER } from './stub-classifier';
import { DATASET } from './dataset';
import type { EvalClassifier, EvalEntry } from './types';

describe('runEval', () => {
  it('returns a report whose totals match the dataset size', async () => {
    const smallSet: EvalEntry[] = DATASET.slice(0, 5);
    const report = await runEval(STUB_CLASSIFIER, smallSet);
    expect(report.total).toBe(5);
    expect(report.classifier).toBe(STUB_CLASSIFIER.label);
    expect(Object.keys(report.byFolder).length).toBeGreaterThan(0);
  });

  it('captures classifier errors per-entry without crashing', async () => {
    let calls = 0;
    const flaky: EvalClassifier = {
      label: 'flaky',
      async classify() {
        calls++;
        if (calls === 2) throw new Error('synthetic failure');
        return { folder: 'INBOX', confidence: 1, latencyMs: 1 };
      },
    };
    const report = await runEval(flaky, DATASET.slice(0, 3));
    expect(report.total).toBe(3);
    // One flaky call shouldn't nuke the whole run.
    expect(calls).toBe(3);
  });

  it('invokes the progress callback once per entry', async () => {
    const onProgress = vi.fn();
    await runEval(STUB_CLASSIFIER, DATASET.slice(0, 4), { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
  });

  it('the stub classifier clears at least 50% accuracy on the full dataset', async () => {
    // Not a quality bar for real classifiers — just a smoke signal that
    // the harness, dataset, and stub all line up coherently.
    const report = await runEval(STUB_CLASSIFIER, DATASET);
    expect(report.accuracy).toBeGreaterThan(0.5);
  });
});
