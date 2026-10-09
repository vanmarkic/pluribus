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

  it('carries each entry\'s language into the report', async () => {
    const report = await runEval(STUB_CLASSIFIER, DATASET);
    const french = DATASET.filter((e) => e.lang === 'fr').length;
    const english = DATASET.filter((e) => e.lang === 'en').length;
    expect(report.byLanguage?.['fr']?.total).toBe(french);
    expect(report.byLanguage?.['en']?.total).toBe(english);
    expect(report.langWeights).toEqual({ fr: 0.95, en: 0.05 });
  });

  it('weights the headline by the requested language mix', async () => {
    const mixed = await runEval(STUB_CLASSIFIER, DATASET, { langWeights: { fr: 0, en: 1 } });
    expect(mixed.weightedAccuracy).toBeCloseTo(mixed.byLanguage?.['en']?.accuracy ?? NaN, 10);
    expect(mixed.langWeights).toEqual({ en: 1 });
  });

  it('keeps per-language numbers when a classifier throws', async () => {
    const broken: EvalClassifier = {
      label: 'broken',
      async classify() {
        throw new Error('down');
      },
    };
    const report = await runEval(broken, DATASET.slice(0, 6));
    expect(Object.values(report.byLanguage ?? {}).reduce((s, m) => s + m.total, 0)).toBe(6);
  });
});

describe('CI gate: the stub classifier on the extended (mostly French) dataset', () => {
  // Same bars as .github/workflows/ci.yml (EVAL_MIN_ACCURACY / EVAL_MIN_MACRO_F1 = 0.75).
  it('clears the language-weighted macro-F1 and accuracy gates', async () => {
    const report = await runEval(STUB_CLASSIFIER, DATASET);
    expect(report.weightedMacroF1).toBeGreaterThanOrEqual(0.75);
    expect(report.weightedAccuracy).toBeGreaterThanOrEqual(0.75);
  });

  it('is not just good at English: the French slice clears the bar on its own', async () => {
    const report = await runEval(STUB_CLASSIFIER, DATASET);
    expect(report.byLanguage?.['fr']?.accuracy).toBeGreaterThanOrEqual(0.75);
    expect(report.byLanguage?.['fr']?.macroF1).toBeGreaterThanOrEqual(0.75);
    expect(report.byLanguage?.['en']?.accuracy).toBeGreaterThanOrEqual(0.75);
  });
});
