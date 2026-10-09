/**
 * System 1 eval classifier.
 *
 * Answers "how well would the production System 1 head do on this labelled
 * dataset?" without touching a mailbox: it embeds every entry once, then runs
 * k-fold cross-validation (k = 4 by default) so that each entry is predicted
 * by a head that never saw it.
 *
 * The head is the production one (core/system1: `trainHead`, `predictProba`,
 * `entropyConfidence`, the scalar features of `buildFeatures`), and the
 * out-of-fold answers go through the production threshold search
 * (`selectThreshold`): the summary says whether a head trained on this much
 * data would arm, and at what coverage. The dataset has no mail headers, so the
 * features that need them (List-Unsubscribe, To, prior replies) are left at
 * zero; the subject-question and sender-domain features are real.
 *
 * The encoder is a plain `embed(text)` function. Unit tests pass a
 * deterministic fake; `npm run eval` with EVAL_CLASSIFIER=system1 passes the
 * real on-device encoder, and EVAL_EMBED_MODEL picks the model so encoders can
 * be compared on the same data. The text that is embedded is the production
 * recipe (`system1Text`), so the numbers carry over.
 */

import type { TriageFolder } from '../core/domain';
import { entropyConfidence } from '../core/system1/confidence';
import { buildFeatures } from '../core/system1/features';
import { mulberry32, predictProba, trainHead } from '../core/system1/linear-head';
import { selectThreshold, type ThresholdSelection } from '../core/system1/threshold';
import { system1Text } from '../core/system1/text';
import { EMAIL_QUESTIONS } from '../core/system1/types';
import type { EvalClassifier, EvalEntry } from './types';

/** `x` is the head's whole input: the embedding followed by the scalar features. */
export type TrainSample = { id: string; x: number[]; label: TriageFolder };
export type HeadPredictor = (x: number[]) => { folder: TriageFolder; confidence: number };
/** Fits a head on training samples and returns its predictor. */
export type HeadTrainer = (samples: TrainSample[]) => HeadPredictor;

export type System1EvalOptions = {
  /** Embeds text with the encoder under test. */
  embed: (text: string) => Promise<ArrayLike<number>>;
  /** Cross-validation folds. Default 4. */
  folds?: number;
  /** Seed for the fold assignment. Default 42. */
  seed?: number;
  /** Shown in the report label, e.g. the encoder model id. */
  modelLabel?: string;
  /** Head to fit per fold. Default: the production linear head. */
  trainer?: HeadTrainer;
  /** Largest acceptable disagreement rate of an armed head (production default 0.05). */
  epsilon?: number;
};

/**
 * What production would conclude from these out-of-fold answers: the threshold
 * `trainSystem1` would pick, or null when no threshold keeps the 95% bound on
 * disagreement below epsilon (the head would stay in shadow mode).
 */
export type System1EvalSummary = {
  epsilon: number;
  /** Out-of-fold answers the search ran on. */
  heldOut: number;
  selection: ThresholdSelection | null;
};

export type System1EvalClassifier = EvalClassifier & { summary: System1EvalSummary };

// ============================================
// Small numeric helpers
// ============================================

function normalize(v: ArrayLike<number>): number[] {
  const out = Array.from(v);
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? out : out.map((x) => x / norm);
}

// ============================================
// Folds
// ============================================

/**
 * Stratified, seeded fold assignment. Returns the fold (0..k-1) of each label.
 * Entries of one class are spread across folds, and fold sizes differ by at
 * most one. There are never more folds than entries.
 */
export function assignFolds(labels: string[], k: number, seed: number): number[] {
  const folds = Math.max(1, Math.min(k, labels.length));
  const rng = mulberry32(seed);
  const byClass = new Map<string, number[]>();
  labels.forEach((label, i) => {
    const group = byClass.get(label);
    if (group) group.push(i);
    else byClass.set(label, [i]);
  });

  const assignment = new Array<number>(labels.length).fill(0);
  let next = 0;
  for (const label of [...byClass.keys()].sort()) {
    const members = byClass.get(label) ?? [];
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [members[i], members[j]] = [members[j]!, members[i]!];
    }
    for (const index of members) {
      assignment[index] = next % folds;
      next++;
    }
  }
  return assignment;
}

// ============================================
// Default head: the production linear softmax head
// ============================================

const FOLDERS = EMAIL_QUESTIONS.folder.options;

/**
 * Fit the production head on the samples and return its predictor. Every
 * folder is a class (as in production), so folders absent from the training
 * folds simply get a vanishing probability.
 */
export function trainLinearHead(samples: TrainSample[], seed = 42): HeadPredictor {
  const inputDim = samples[0]?.x.length ?? 0;
  if (inputDim === 0) throw new Error('Cannot train a head without samples');
  const classIndex = new Map(FOLDERS.map((folder, i) => [folder as string, i]));

  const { W, b } = trainHead(
    samples.map((s) => ({ x: s.x, y: classIndex.get(s.label) ?? 0 })),
    { classes: FOLDERS.length, inputDim, seed },
  );

  return (x) => {
    const probabilities = predictProba(W, b, x);
    let top = 0;
    probabilities.forEach((p, k) => {
      if (p > (probabilities[top] ?? 0)) top = k;
    });
    return {
      folder: (FOLDERS[top] ?? 'INBOX') as TriageFolder,
      confidence: entropyConfidence(probabilities),
    };
  };
}

// ============================================
// The eval classifier
// ============================================

type Prediction = { folder: TriageFolder; confidence: number; latencyMs: number };

/**
 * Embed the dataset and cross-validate. Heavy work (embedding, training)
 * happens here; the returned classifier just looks up the out-of-fold
 * prediction for each entry.
 */
export async function createSystem1EvalClassifier(
  dataset: EvalEntry[],
  options: System1EvalOptions,
): Promise<System1EvalClassifier> {
  if (dataset.length < 2) {
    throw new Error('The System 1 eval needs at least 2 entries to cross-validate');
  }
  const seed = options.seed ?? 42;
  const epsilon = options.epsilon ?? 0.05;
  const trainer: HeadTrainer = options.trainer ?? ((samples) => trainLinearHead(samples, seed));

  // 1. Embed every entry once, exactly as production would (system1Text), and add the
  //    scalar features that can be computed without mail headers.
  const vectors: number[][] = [];
  const embedMs: number[] = [];
  for (const entry of dataset) {
    const text = system1Text(
      {
        subject: entry.subject,
        from: { address: entry.from.address, name: entry.from.name ?? null },
      },
      entry.body,
    );
    const started = Date.now();
    const embedding = normalize(await options.embed(text));
    embedMs.push(Date.now() - started);
    const features = buildFeatures(
      {
        from: { address: entry.from.address, name: entry.from.name ?? null },
        to: [],
        subject: entry.subject,
        inReplyTo: null,
        listUnsubscribe: null,
      },
      { myAddress: '', priorRepliesToSender: 0 },
    );
    vectors.push([...embedding, ...features]);
  }

  // 2. k-fold: train on the other folds, predict the held-out one.
  const folds = assignFolds(
    dataset.map((e) => e.expectedFolder),
    options.folds ?? 4,
    seed,
  );
  const foldCount = Math.max(...folds) + 1;
  const predictions = new Map<string, Prediction>();

  for (let fold = 0; fold < foldCount; fold++) {
    const training: TrainSample[] = [];
    dataset.forEach((entry, i) => {
      if (folds[i] !== fold) {
        training.push({ id: entry.id, x: vectors[i]!, label: entry.expectedFolder });
      }
    });
    const predict = trainer(training);
    dataset.forEach((entry, i) => {
      if (folds[i] !== fold) return;
      const started = Date.now();
      const { folder, confidence } = predict(vectors[i]!);
      predictions.set(entry.id, {
        folder,
        confidence,
        latencyMs: Math.max(1, embedMs[i]! + (Date.now() - started)),
      });
    });
  }

  // 3. What production would do with these answers: pick a threshold or stay in shadow mode.
  const heldOut = dataset.map((entry) => {
    const prediction = predictions.get(entry.id)!;
    return {
      confidence: prediction.confidence,
      correct: prediction.folder === entry.expectedFolder,
    };
  });
  const summary: System1EvalSummary = {
    epsilon,
    heldOut: heldOut.length,
    selection: selectThreshold(heldOut, { epsilon }),
  };

  const modelLabel = options.modelLabel ? ` ${options.modelLabel}` : '';
  return {
    summary,
    label: `system1-${foldCount}fold${modelLabel}`,
    async classify(entry) {
      const prediction = predictions.get(entry.id);
      if (!prediction) throw new Error(`Entry ${entry.id} is not in the eval set`);
      return { ...prediction, costUsd: 0 };
    },
  };
}
