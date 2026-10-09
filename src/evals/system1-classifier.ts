/**
 * System 1 eval classifier.
 *
 * Answers "how well would a small head on frozen sentence embeddings do on
 * this labelled dataset?" without touching a mailbox: it embeds every entry
 * once, then runs k-fold cross-validation (k = 4 by default) so that each
 * entry is predicted by a head that never saw it.
 *
 * The encoder is a plain `embed(text)` function. Unit tests pass a
 * deterministic fake; `npm run eval` with EVAL_CLASSIFIER=system1 passes the
 * real on-device encoder, and EVAL_EMBED_MODEL picks the model so encoders can
 * be compared on the same data. The text that is embedded is the production
 * recipe (`system1Text`), so the numbers carry over.
 *
 * TODO(P6b): the default head below is a tiny nearest-centroid classifier so
 * this file does not depend on the System 1 core. Switch the `trainer` to
 * core/system1 `trainHead` (and `entropyConfidence`) once both are merged;
 * the `HeadTrainer` seam is the only thing that has to change.
 */

import type { TriageFolder } from '../core/domain';
import { system1Text } from '../core/system1/text';
import type { EvalClassifier, EvalEntry } from './types';

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
  /** Head to fit per fold. Default: nearest centroid. */
  trainer?: HeadTrainer;
};

// ============================================
// Small numeric helpers
// ============================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: ArrayLike<number>): number[] {
  const out = Array.from(v);
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? out : out.map((x) => x / norm);
}

const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((s, e) => s + e, 0);
  return exps.map((e) => e / sum);
}

/** 1 - H(p) / ln(K): 1 for a one-hot distribution, 0 for a uniform one. */
function entropyConfidence(p: number[]): number {
  if (p.length < 2) return 1;
  const h = -p.reduce((s, x) => s + (x > 0 ? x * Math.log(x) : 0), 0);
  return Math.max(0, Math.min(1, 1 - h / Math.log(p.length)));
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
// Default head: nearest centroid with a fitted temperature
// ============================================

const SCALE_GRID = [4, 8, 16, 32, 64, 128];
const DEFAULT_SCALE = 20;

/**
 * Class centroids of unit-length embeddings; the prediction is a softmax over
 * scaled cosine similarity to each centroid. The scale (sharpness) is picked
 * on the training data by leave-one-out log loss, so the confidence is
 * roughly calibrated for the encoder at hand without any tuning by hand.
 */
export function trainCentroidHead(
  samples: Array<{ x: number[]; label: TriageFolder }>,
): HeadPredictor {
  const dim = samples[0]?.x.length ?? 0;
  const labels = [...new Set(samples.map((s) => s.label))].sort();
  const xs = samples.map((s) => normalize(s.x));

  const sums = new Map<TriageFolder, number[]>();
  const counts = new Map<TriageFolder, number>();
  samples.forEach((s, i) => {
    const sum = sums.get(s.label) ?? new Array<number>(dim).fill(0);
    xs[i]!.forEach((value, d) => {
      sum[d] = (sum[d] ?? 0) + value;
    });
    sums.set(s.label, sum);
    counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  });

  const centroids = labels.map((label) => normalize(sums.get(label) ?? []));

  // Leave-one-out: how well does each training sample fit its own class when
  // it is removed from that class's centroid?
  const loo: Array<{ sims: number[]; own: number }> = [];
  samples.forEach((s, i) => {
    if ((counts.get(s.label) ?? 0) < 2) return;
    const x = xs[i]!;
    const sims = labels.map((label, k) => {
      if (label !== s.label) return dot(x, centroids[k]!);
      const without = (sums.get(label) ?? []).map((v, d) => v - (x[d] ?? 0));
      return dot(x, normalize(without));
    });
    loo.push({ sims, own: labels.indexOf(s.label) });
  });

  let scale = DEFAULT_SCALE;
  if (loo.length > 0) {
    let best = Infinity;
    for (const candidate of SCALE_GRID) {
      const nll =
        loo.reduce((s, { sims, own }) => {
          const p = softmax(sims.map((v) => v * candidate))[own] ?? 0;
          return s - Math.log(Math.max(p, 1e-12));
        }, 0) / loo.length;
      if (nll < best) {
        best = nll;
        scale = candidate;
      }
    }
  }

  return (x) => {
    const q = normalize(x);
    const probs = softmax(centroids.map((c) => dot(q, c) * scale));
    let top = 0;
    probs.forEach((p, k) => {
      if (p > (probs[top] ?? 0)) top = k;
    });
    return { folder: labels[top] ?? 'INBOX', confidence: entropyConfidence(probs) };
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
): Promise<EvalClassifier> {
  if (dataset.length < 2) {
    throw new Error('The System 1 eval needs at least 2 entries to cross-validate');
  }
  const trainer: HeadTrainer = options.trainer ?? ((samples) => trainCentroidHead(samples));

  // 1. Embed every entry once, exactly as production would (system1Text).
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
    vectors.push(normalize(await options.embed(text)));
    embedMs.push(Date.now() - started);
  }

  // 2. k-fold: train on the other folds, predict the held-out one.
  const folds = assignFolds(
    dataset.map((e) => e.expectedFolder),
    options.folds ?? 4,
    options.seed ?? 42,
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

  const modelLabel = options.modelLabel ? ` ${options.modelLabel}` : '';
  return {
    label: `system1-${foldCount}fold${modelLabel}`,
    async classify(entry) {
      const prediction = predictions.get(entry.id);
      if (!prediction) throw new Error(`Entry ${entry.id} is not in the eval set`);
      return { ...prediction, costUsd: 0 };
    },
  };
}
