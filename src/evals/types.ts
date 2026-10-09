/**
 * Eval harness types (#92).
 *
 * Shared between the dataset, metrics, runner, and any classifier
 * implementation we point the harness at.
 */

import type { TriageFolder } from '../core/domain';

/** Language of an eval email. The user's mail is ~95% French, ~5% English. */
export type EvalLang = 'fr' | 'en';

export type EvalEntry = {
  id: string;
  from: { address: string; name?: string };
  subject: string;
  body: string;
  expectedFolder: TriageFolder;
  /** Language of subject and body, so reports can be sliced (and weighted) per language. */
  lang: EvalLang;
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
  /** Language of the entry (absent in results from older runs). */
  lang?: EvalLang;
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

/** Headline numbers for the entries of one language. */
export type LanguageMetrics = {
  total: number;
  correct: number;
  accuracy: number;
  macroF1: number;
};

/**
 * Selective-prediction view: what happens when low-confidence answers are
 * escalated (to the LLM) instead of acted on. These only mean something for a
 * classifier whose confidence is meaningful (System 1, the LLM).
 */
export type SelectiveMetrics = {
  /** Expected calibration error over 10 equal-width confidence bins (0 = perfectly calibrated). */
  ece: number;
  /** Accuracy on the most confident X% of answers, keyed by the coverage ("0.5", "0.8"). */
  accuracyAtCoverage: Record<string, number>;
  /** Share of answers with confidence below `escalationThreshold` (they would escalate). */
  escalationRate: number;
  escalationThreshold: number;
};

export type EvalReport = {
  runAt: string; // ISO timestamp
  classifier: string; // label identifying which classifier ran
  total: number;
  correct: number;
  /** Over all entries, unweighted. */
  accuracy: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  byFolder: Record<string, PerFolderMetrics>;
  /** confusion[expected][actual] = count */
  confusion: Record<string, Record<string, number>>;
  /** Over all entries, unweighted. */
  macroF1: number;
  /** Per language, when the results carry a language. */
  byLanguage?: Record<string, LanguageMetrics>;
  /** The weights behind the weighted numbers (languages present in the run, summing to 1). */
  langWeights?: Record<string, number>;
  /**
   * Headline numbers: the per-language metrics averaged with the user's
   * language mix (EVAL_LANG_WEIGHTS, default fr:0.95,en:0.05). Equal to the
   * unweighted numbers when the results carry no language.
   */
  weightedAccuracy?: number;
  weightedMacroF1?: number;
  selective?: SelectiveMetrics;
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
