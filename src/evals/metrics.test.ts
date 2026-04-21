import { describe, it, expect } from 'vitest';
import { computeReport, diffReports, formatReport } from './metrics';
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
});
