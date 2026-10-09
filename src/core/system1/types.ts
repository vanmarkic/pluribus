/**
 * System 1 types
 *
 * Pure types for the local "System 1" classifier: a frozen embedding plus a
 * small scalar feature vector feeds tiny per-question heads. Confident heads
 * answer locally; uncertain ones escalate to the LLM ("System 2").
 *
 * Zero runtime dependencies beyond the domain constants.
 */

import { TRIAGE_FOLDERS } from '../domain';

// ============================================
// Questions
// ============================================

export type ChoiceQuestion = { kind: 'choice'; id: string; options: readonly string[] };
/** Ordinal score; `levels` is the legend, the value is 1..levels.length. */
export type ScoreQuestion = { kind: 'score'; id: string; levels: readonly string[] };
export type NoulQuestion = { kind: 'noul'; id: string; statement: string };
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

// ============================================
// Answers
// ============================================

export type ChoiceAnswer = {
  kind: 'choice';
  questionId: string;
  value: string;
  probabilities: Record<string, number>;
  confidence: number;
  escalate: boolean;
};

export type ScoreAnswer = {
  kind: 'score';
  questionId: string;
  value: number;
  probabilities: number[];
  confidence: number;
  escalate: boolean;
};

export type NoulAnswer = {
  kind: 'noul';
  questionId: string;
  value: boolean;
  probability: number;
  confidence: number;
  escalate: boolean;
};

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

// ============================================
// Model state
// ============================================

/** The "state" Jev-style: frozen embedding + small scalar feature vector. */
export type System1Input = { embedding: Float32Array; features: number[] };

export type HeadWeights = {
  questionId: string;
  kind: Question['kind'];
  /** Class labels in output order (noul: ['false','true']; score: ['1'..'n']). */
  labels: string[];
  /** Embedding dim + features length. */
  inputDim: number;
  /** [labels.length][inputDim] */
  W: number[][];
  /** [labels.length] */
  b: number[];
  featureNames: string[];
};

export type HeadMetrics = {
  trainSize: number;
  holdoutSize: number;
  /** Accuracy vs labels on holdout. */
  holdoutAgreement: number;
  /** Fraction of holdout accepted at threshold. */
  coverage: number;
  /** Clopper-Pearson 95% upper bound among accepted. */
  disagreementUpperBound: number;
  auditCount: number;
  /** Rolling agreement with System 2 audits. */
  auditAgreement: number | null;
};

export type HeadRecord = {
  questionId: string;
  version: number;
  embeddingModel: string;
  weights: HeadWeights;
  /** Confidence threshold tau. */
  threshold: number;
  armed: boolean;
  metrics: HeadMetrics;
  trainedAt: Date;
};

export type TrainingSample = {
  emailId: number;
  input: System1Input;
  label: string;
  gold: boolean;
};

export type System1HeadStatus = {
  questionId: string;
  armed: boolean;
  version: number | null;
  coverage: number | null;
  agreement: number | null;
  disagreementUpperBound: number | null;
  trainSize: number;
  trainedAt: Date | null;
};

export type System1Status = {
  embeddingModel: string;
  heads: System1HeadStatus[];
  /**
   * The on-device encoder model is on disk. It is only downloaded when the user
   * asks (or imports it); until then System 1 is off and the LLM decides.
   */
  modelInstalled: boolean;
  /** The user's "Download model" request is running. */
  modelDownloading: boolean;
  /** Why the last download failed; null when it did not (or the model is installed since). */
  modelError: string | null;
};

// ============================================
// Email questions
// ============================================

export const EMAIL_QUESTIONS = {
  folder: { kind: 'choice', id: 'folder', options: TRIAGE_FOLDERS },
  needsReply: {
    kind: 'noul',
    id: 'needsReply',
    statement: 'This email expects a personal reply from me.',
  },
  importance: {
    kind: 'score',
    id: 'importance',
    levels: [
      'low: can be ignored',
      'normal: read when convenient',
      'important: affects my work or commitments',
      'critical: urgent, time-sensitive or high-stakes',
    ],
  },
} as const satisfies Record<string, Question>;
