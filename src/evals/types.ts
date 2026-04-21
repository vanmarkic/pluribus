/**
 * Eval harness types (#92).
 *
 * Shared between the dataset, metrics, runner, and any classifier
 * implementation we point the harness at.
 */

import type { TriageFolder } from '../core/domain';

export type EvalEntry = {
  id: string;
  from: { address: string; name?: string };
  subject: string;
  body: string;
  expectedFolder: TriageFolder;
  /** Optional free-form tag so we can slice metrics by category later. */
  tags?: string[];
};

/** A single classifier decision plus its ground-truth comparison. */
export type EvalResult = {
  id: string;
  expected: TriageFolder;
  actual: TriageFolder;
  confidence: number;
  latencyMs: number;
  costUsd: number;
  correct: boolean;
  error?: string;
};

/** Per-folder confusion counts + derived precision/recall/F1. */
export type PerFolderMetrics = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  support: number; // expected count
};

export type EvalReport = {
  runAt: string;            // ISO timestamp
  classifier: string;        // label identifying which classifier ran
  total: number;
  correct: number;
  accuracy: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  byFolder: Record<string, PerFolderMetrics>;
  /** confusion[expected][actual] = count */
  confusion: Record<string, Record<string, number>>;
  macroF1: number;
};

/**
 * The minimal interface the eval harness requires from any classifier under
 * test. Kept intentionally narrow — no Email/EmailBody types, no Electron
 * deps — so the harness can run in plain Node.
 */
export type EvalClassifier = {
  label: string;
  classify: (entry: EvalEntry) => Promise<{
    folder: TriageFolder;
    confidence: number;
    latencyMs: number;
    costUsd?: number;
  }>;
};
