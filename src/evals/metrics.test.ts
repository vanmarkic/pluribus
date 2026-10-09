import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeReport,
  diffReports,
  formatReport,
  parseLangWeights,
  DEFAULT_LANG_WEIGHTS,
  accuracyAtCoverage,
  escalationRate,
  expectedCalibrationError,
} from './metrics';
import type { EvalResult } from './types';
import type { TriageFolder } from '../core/domain';

const ALL_FOLDERS: TriageFolder[] = [
  'INBOX', 'Planning', 'Review',
  'Paper-Trail/Invoices', 'Paper-Trail/Admin', 'Paper-Trail/Travel',
  'Feed', 'Social', 'Promotions', 'Archive',
];

const r = (expected: TriageFolder, actual: TriageFolder, latencyMs = 10, costUsd = 0): EvalResult => ({
  id: `${expected}-${actual}-${Math.random()}`,
  expected,
  actual,
  confidence: 0.9,
  latencyMs,
  costUsd,
  correct: expected === actual,
});

describe('computeReport', () => {
  it('computes accuracy and correct counts', () => {
    const report = computeReport(
      [r('Feed', 'Feed'), r('Feed', 'Feed'), r('Feed', 'INBOX')],
      'test',
      ALL_FOLDERS,
    );
    expect(report.total).toBe(3);
    expect(report.correct).toBe(2);
    expect(report.accuracy).toBeCloseTo(2 / 3, 5);
  });

  it('computes precision/recall/F1 per folder', () => {
    // Feed: 2 TP, 1 FN (Feed→INBOX), 0 FP
    // INBOX: 1 TP (INBOX→INBOX), 0 FN, 1 FP (Feed→INBOX)
    const report = computeReport(
      [
        r('Feed', 'Feed'),
        r('Feed', 'Feed'),
        r('Feed', 'INBOX'),
        r('INBOX', 'INBOX'),
      ],
      'test',
      ALL_FOLDERS,
    );
    const feed = report.byFolder['Feed'];
    expect(feed.tp).toBe(2);
    expect(feed.fp).toBe(0);
    expect(feed.fn).toBe(1);
    expect(feed.precision).toBe(1);
    expect(feed.recall).toBeCloseTo(2 / 3, 5);
    expect(feed.f1).toBeCloseTo(2 * 1 * (2 / 3) / (1 + 2 / 3), 5);

    const inbox = report.byFolder['INBOX'];
    expect(inbox.tp).toBe(1);
    expect(inbox.fp).toBe(1);
    expect(inbox.fn).toBe(0);
    expect(inbox.precision).toBe(0.5);
    expect(inbox.recall).toBe(1);
  });

  it('builds a confusion matrix', () => {
    const report = computeReport(
      [r('Feed', 'Feed'), r('Feed', 'Promotions'), r('Promotions', 'Promotions')],
      'test',
      ALL_FOLDERS,
    );
    expect(report.confusion['Feed']['Feed']).toBe(1);
    expect(report.confusion['Feed']['Promotions']).toBe(1);
    expect(report.confusion['Promotions']['Promotions']).toBe(1);
  });

  it('computes p50 and p95 latency from sorted values', () => {
    const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(ms => r('Feed', 'Feed', ms));
    const report = computeReport(results, 'test', ALL_FOLDERS);
    // percentile is `Math.floor(p * length)`: p50 → index 5 → value 6
    expect(report.p50LatencyMs).toBe(6);
    expect(report.p95LatencyMs).toBe(10);
  });

  it('averages F1 only over folders that appear in ground truth (macro-F1)', () => {
    // Only Feed has support in this dataset; INBOX doesn't appear as expected.
    const report = computeReport([r('Feed', 'Feed'), r('Feed', 'Feed')], 'test', ALL_FOLDERS);
    const supportedFolders = Object.values(report.byFolder).filter(m => m.support > 0);
    expect(supportedFolders).toHaveLength(1);
    expect(report.macroF1).toBe(1);
  });

  it('returns zeros on an empty result list without dividing by zero', () => {
    const report = computeReport([], 'test', ALL_FOLDERS);
    expect(report.total).toBe(0);
    expect(report.accuracy).toBe(0);
    expect(report.macroF1).toBe(0);
    expect(report.p50LatencyMs).toBe(0);
  });

  it('sums costs across all results', () => {
    const report = computeReport(
      [r('Feed', 'Feed', 10, 0.01), r('Feed', 'Feed', 10, 0.02)],
      'test',
      ALL_FOLDERS,
    );
    expect(report.totalCostUsd).toBeCloseTo(0.03, 5);
  });
});

describe('diffReports', () => {
  it('computes deltas between two reports', () => {
    const prev = computeReport([r('Feed', 'INBOX')], 'v1', ALL_FOLDERS);
    const next = computeReport([r('Feed', 'Feed')], 'v2', ALL_FOLDERS);
    const diff = diffReports(prev, next);
    expect(diff.accuracyDelta).toBe(1);
    expect(diff.macroF1Delta).toBe(1);
  });
});

describe('formatReport', () => {
  it('renders a text table without crashing', () => {
    const report = computeReport(
      [r('Feed', 'Feed'), r('INBOX', 'INBOX'), r('Promotions', 'INBOX')],
      'test',
      ALL_FOLDERS,
    );
    const s = formatReport(report);
    expect(s).toContain('Eval report');
    expect(s).toContain('accuracy:');
    expect(s).toContain('Feed');
    expect(s).toContain('INBOX');
  });

  it('shows the per-language breakdown and the language-weighted headline', () => {
    const report = computeReport(
      [rl('fr', 'Feed', 'Feed'), rl('fr', 'Feed', 'INBOX'), rl('en', 'Feed', 'Feed')],
      'test',
      ALL_FOLDERS,
    );
    const s = formatReport(report);
    expect(s).toContain('weighted accuracy');
    expect(s).toContain('weighted macro-F1');
    expect(s).toMatch(/fr\s+2\s+/);
    expect(s).toMatch(/en\s+1\s+/);
    expect(s).toContain('ECE');
  });
});

/** A result tagged with a language, optionally with a confidence. */
const rl = (
  lang: 'fr' | 'en',
  expected: TriageFolder,
  actual: TriageFolder,
  confidence = 0.9,
): EvalResult => ({ ...r(expected, actual), lang, confidence });

describe('computeReport - language slices', () => {
  it('breaks accuracy and macro-F1 down per language', () => {
    const report = computeReport(
      [
        rl('fr', 'Feed', 'Feed'),
        rl('fr', 'Feed', 'Feed'),
        rl('fr', 'INBOX', 'Feed'),
        rl('fr', 'INBOX', 'INBOX'),
        rl('en', 'Feed', 'Feed'),
        rl('en', 'INBOX', 'INBOX'),
      ],
      'test',
      ALL_FOLDERS,
    );
    expect(report.byLanguage?.['fr']).toMatchObject({ total: 4, correct: 3, accuracy: 0.75 });
    expect(report.byLanguage?.['en']).toMatchObject({ total: 2, correct: 2, accuracy: 1, macroF1: 1 });
    // fr: Feed P=2/3 R=1 -> 0.8; INBOX P=1 R=1/2 -> 2/3; macro = (0.8 + 2/3) / 2
    expect(report.byLanguage?.['fr']?.macroF1).toBeCloseTo((0.8 + 2 / 3) / 2, 5);
  });

  it('weights the headline by the language mix (default 95% French, 5% English)', () => {
    const report = computeReport(
      [rl('fr', 'Feed', 'INBOX'), rl('fr', 'Feed', 'INBOX'), rl('en', 'Feed', 'Feed')],
      'test',
      ALL_FOLDERS,
    );
    // fr accuracy 0, en accuracy 1 -> 0.95*0 + 0.05*1
    expect(report.weightedAccuracy).toBeCloseTo(0.05, 5);
    expect(report.langWeights).toEqual({ fr: 0.95, en: 0.05 });
    // The unweighted numbers are unchanged: 1 of 3 correct.
    expect(report.accuracy).toBeCloseTo(1 / 3, 5);
  });

  it('uses custom weights and renormalises over the languages that are present', () => {
    const report = computeReport(
      [rl('fr', 'Feed', 'Feed'), rl('fr', 'Feed', 'INBOX')],
      'test',
      ALL_FOLDERS,
      { langWeights: { fr: 0.5, en: 0.5 } },
    );
    expect(report.langWeights).toEqual({ fr: 1 });
    expect(report.weightedAccuracy).toBeCloseTo(0.5, 5);

    const custom = computeReport(
      [rl('fr', 'Feed', 'INBOX'), rl('en', 'Feed', 'Feed')],
      'test',
      ALL_FOLDERS,
      { langWeights: { fr: 0.25, en: 0.75 } },
    );
    expect(custom.weightedAccuracy).toBeCloseTo(0.75, 5);
    expect(custom.weightedMacroF1).toBeCloseTo(0.75, 5);
  });

  it('falls back to the unweighted numbers when results carry no language', () => {
    const report = computeReport([r('Feed', 'Feed'), r('Feed', 'INBOX')], 'test', ALL_FOLDERS);
    expect(report.byLanguage).toEqual({});
    expect(report.weightedAccuracy).toBeCloseTo(0.5, 5);
    expect(report.weightedMacroF1).toBe(report.macroF1);
  });

  it('ignores languages that have no weight', () => {
    const report = computeReport(
      [rl('fr', 'Feed', 'Feed'), rl('en', 'Feed', 'INBOX')],
      'test',
      ALL_FOLDERS,
      { langWeights: { fr: 1 } },
    );
    expect(report.weightedAccuracy).toBe(1);
    expect(report.langWeights).toEqual({ fr: 1 });
  });
});

describe('parseLangWeights', () => {
  it('defaults to the user mix: 95% French, 5% English', () => {
    expect(parseLangWeights(undefined)).toEqual({ fr: 0.95, en: 0.05 });
    expect(parseLangWeights('')).toEqual({ fr: 0.95, en: 0.05 });
    expect(DEFAULT_LANG_WEIGHTS).toEqual({ fr: 0.95, en: 0.05 });
  });

  it('parses fr:0.95,en:0.05 and normalises to 1', () => {
    expect(parseLangWeights('fr:0.9,en:0.1')).toEqual({ fr: 0.9, en: 0.1 });
    const w = parseLangWeights(' FR : 3 , en : 1 ');
    expect(w['fr']).toBeCloseTo(0.75, 5);
    expect(w['en']).toBeCloseTo(0.25, 5);
  });

  it('rejects malformed or all-zero specs', () => {
    for (const bad of ['fr', 'fr:abc', 'fr:-1', 'fr:0,en:0', 'fr:0.5,fr:0.5', ':1']) {
      expect(() => parseLangWeights(bad)).toThrow(/EVAL_LANG_WEIGHTS/);
    }
  });
});

describe('selective prediction metrics', () => {
  const pts = (items: Array<[number, boolean]>) =>
    items.map(([confidence, correct]) => ({ confidence, correct }));

  describe('accuracyAtCoverage', () => {
    const sample = pts([
      [0.6, true],
      [0.9, true],
      [0.7, false],
      [0.8, true],
    ]);

    it('is the accuracy on the most confident share of answers', () => {
      expect(accuracyAtCoverage(sample, 0.5)).toBe(1); // 0.9, 0.8 -> both right
      expect(accuracyAtCoverage(sample, 1)).toBe(0.75);
    });

    it('rounds the number of kept answers up', () => {
      // 0.75 * 4 = 3 answers: 0.9 (right), 0.8 (right), 0.7 (wrong)
      expect(accuracyAtCoverage(sample, 0.75)).toBeCloseTo(2 / 3, 5);
      // 0.3 * 4 = 1.2 -> 2 answers
      expect(accuracyAtCoverage(sample, 0.3)).toBe(1);
    });

    it('handles the edges: empty input, zero and over-full coverage', () => {
      expect(accuracyAtCoverage([], 0.5)).toBe(0);
      expect(accuracyAtCoverage(sample, 0)).toBe(0);
      expect(accuracyAtCoverage(sample, 2)).toBe(0.75);
    });

    it('is the overall accuracy at full coverage, and never below it at lower coverage for a ranked-by-confidence set', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean()), {
            minLength: 1,
            maxLength: 60,
          }),
          (items) => {
            const points = pts(items);
            const overall = points.filter((p) => p.correct).length / points.length;
            expect(accuracyAtCoverage(points, 1)).toBeCloseTo(overall, 10);
            const v = accuracyAtCoverage(points, 0.5);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          },
        ),
      );
    });
  });

  describe('escalationRate', () => {
    it('is the share of answers below the threshold', () => {
      const sample = pts([
        [0.95, true],
        [0.7, true],
        [0.6, false],
        [0.3, false],
      ]);
      expect(escalationRate(sample, 0.7)).toBe(0.5); // 0.6 and 0.3 escalate; 0.7 does not
      expect(escalationRate(sample, 0)).toBe(0);
      expect(escalationRate(sample, 1)).toBe(1);
      expect(escalationRate([], 0.7)).toBe(0);
    });
  });

  describe('expectedCalibrationError', () => {
    it('is ~0 for a perfectly calibrated set', () => {
      // 10 bins, 100 answers each; in bin b the confidence is (b + 0.5) / 10
      // and exactly that share of the answers is correct.
      const points: Array<{ confidence: number; correct: boolean }> = [];
      for (let bin = 0; bin < 10; bin++) {
        const confidence = (bin + 0.5) / 10;
        const right = Math.round(confidence * 100);
        for (let i = 0; i < 100; i++) points.push({ confidence, correct: i < right });
      }
      expect(expectedCalibrationError(points)).toBeCloseTo(0, 10);
    });

    it('is the full gap for a confidently wrong classifier', () => {
      const wrong = Array.from({ length: 20 }, () => ({ confidence: 1, correct: false }));
      expect(expectedCalibrationError(wrong)).toBeCloseTo(1, 10); // confidence 1.0 lands in the last bin
      const unsure = Array.from({ length: 20 }, () => ({ confidence: 0.05, correct: true }));
      expect(expectedCalibrationError(unsure)).toBeCloseTo(0.95, 10);
    });

    it('weights bins by how many answers they hold', () => {
      // 3 answers at 0.9 (all right -> gap 0.1), 1 answer at 0.1 (wrong -> gap 0.1... right: gap 0.9)
      const points = pts([
        [0.9, true],
        [0.9, true],
        [0.9, true],
        [0.1, true],
      ]);
      // bin 9: |1 - 0.9| * 3/4; bin 1: |1 - 0.1| * 1/4
      expect(expectedCalibrationError(points)).toBeCloseTo(0.075 + 0.225, 10);
    });

    it('supports a different bin count and an empty set', () => {
      expect(expectedCalibrationError([], 10)).toBe(0);
      const points = pts([
        [0.2, true],
        [0.4, false],
      ]);
      // 2 bins: [0, 0.5) holds both; mean conf 0.3, accuracy 0.5
      expect(expectedCalibrationError(points, 2)).toBeCloseTo(0.2, 10);
    });

    it('stays within [0, 1]', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean()), {
            maxLength: 80,
          }),
          (items) => {
            const e = expectedCalibrationError(pts(items));
            expect(e).toBeGreaterThanOrEqual(0);
            expect(e).toBeLessThanOrEqual(1 + 1e-12);
          },
        ),
      );
    });
  });

  it('computeReport carries the selective numbers', () => {
    const report = computeReport(
      [
        rl('fr', 'Feed', 'Feed', 0.95),
        rl('fr', 'Feed', 'Feed', 0.9),
        rl('fr', 'Feed', 'INBOX', 0.4),
        rl('fr', 'INBOX', 'INBOX', 0.8),
      ],
      'test',
      ALL_FOLDERS,
      { escalationThreshold: 0.5 },
    );
    expect(report.selective?.escalationThreshold).toBe(0.5);
    expect(report.selective?.escalationRate).toBe(0.25);
    expect(report.selective?.accuracyAtCoverage['0.5']).toBe(1);
    // 80% of 4 answers rounds up to all 4: 3 right.
    expect(report.selective?.accuracyAtCoverage['0.8']).toBeCloseTo(0.75, 5);
    expect(report.selective?.ece).toBeGreaterThan(0);
  });
});
