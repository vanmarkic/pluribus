/**
 * System 1 use cases (Milestone 2)
 *
 * Status, (re)training and auditing of the local System 1 heads.
 *
 * Training is Jevstiller-style: the labels are the teacher's (System 2)
 * answers, upgraded by the user's own actions where they exist. 20 percent of
 * the labelled mail is held out, and a head only arms if some confidence
 * threshold has a Clopper-Pearson bound on its disagreement with the labels
 * at or below the configured target. Armed heads are then audited against the
 * teacher at run time; a head whose audits drift is disarmed until the next
 * retrain.
 */

import type { Deps } from '../ports';
import { readSystem1Settings } from '../system1/settings';
import { clopperPearsonUpper } from '../system1/bounds';
import { entropyConfidence } from '../system1/confidence';
import { FEATURE_NAMES, fnv1a32 } from '../system1/features';
import { mulberry32, predictProba, trainHead, type HeadSample } from '../system1/linear-head';
import { toHeadWeights } from '../system1/serialize';
import { selectThreshold } from '../system1/threshold';
import {
  EMAIL_QUESTIONS,
  type HeadMetrics,
  type Question,
  type System1HeadStatus,
  type System1Status,
  type TrainingSample,
} from '../system1/types';

/** Questions System 1 answers, in the order they are reported. */
const QUESTIONS: readonly Question[] = [
  EMAIL_QUESTIONS.folder,
  EMAIL_QUESTIONS.needsReply,
  EMAIL_QUESTIONS.importance,
];

/** Fewest labelled emails worth fitting a head on. */
const MIN_SAMPLES = 60;
/** A class needs this many examples to count towards the "at least two classes" rule. */
const MIN_PER_CLASS = 5;
const HOLDOUT_FRACTION = 0.2;
/** Training weight of labels that come from the user's own actions. */
const GOLD_WEIGHT = 3;
const BOUND_ALPHA = 0.05;

/** Audits before drift can disarm a head. */
const MIN_AUDITS_FOR_DRIFT = 20;
/** Rolling agreement: plain mean for the first 1/alpha audits, exponential average after. */
const AUDIT_EMA_ALPHA = 0.02;

function labelsOf(question: Question): string[] {
  switch (question.kind) {
    case 'choice':
      return [...question.options];
    case 'noul':
      return ['false', 'true'];
    case 'score':
      return question.levels.map((_, i) => String(i + 1));
  }
}

const emptyStatus = (questionId: string): System1HeadStatus => ({
  questionId,
  armed: false,
  version: null,
  coverage: null,
  agreement: null,
  disagreementUpperBound: null,
  trainSize: 0,
  trainedAt: null,
});

async function buildStatus(
  deps: Pick<Deps, 'system1Heads' | 'embeddingService'>,
): Promise<System1Status> {
  const embeddingModel = deps.embeddingService.getModel();
  // An encoder that cannot say (a script or test encoder) has no download step: it is "installed".
  const model = deps.embeddingService.getDownloadState?.() ?? {
    installed: true,
    downloading: false,
    error: null,
  };
  const heads = await Promise.all(QUESTIONS.map((q) => deps.system1Heads.getLatest(q.id)));
  return {
    embeddingModel,
    modelInstalled: model.installed,
    modelDownloading: model.downloading,
    modelError: model.error,
    heads: QUESTIONS.map((q, i): System1HeadStatus => {
      const head = heads[i];
      if (!head) return emptyStatus(q.id);
      return {
        questionId: q.id,
        // A head from another encoder cannot answer, whatever its stored flag says.
        armed: head.armed && head.embeddingModel === embeddingModel,
        version: head.version,
        coverage: head.metrics.coverage,
        agreement: head.metrics.holdoutAgreement,
        disagreementUpperBound: head.metrics.disagreementUpperBound,
        trainSize: head.metrics.trainSize,
        trainedAt: head.trainedAt,
      };
    }),
  };
}

export const getSystem1Status =
  (deps: Pick<Deps, 'system1Heads' | 'embeddingService'>) => async (): Promise<System1Status> =>
    buildStatus(deps);

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

type Prepared = {
  samples: TrainingSample[];
  dim: number;
  featureCount: number;
};

/** Keep samples with a known label and the dominant input dimension, in a stable order. */
function prepare(raw: readonly TrainingSample[], labels: readonly string[]): Prepared | null {
  const known = new Set(labels);
  const labelled = raw.filter((s) => known.has(s.label));

  const dimOf = (s: TrainingSample) => s.input.embedding.length + s.input.features.length;
  const counts = new Map<number, number>();
  for (const s of labelled) counts.set(dimOf(s), (counts.get(dimOf(s)) ?? 0) + 1);
  let dim = 0;
  let best = 0;
  for (const [d, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > best) {
      best = count;
      dim = d;
    }
  }
  if (best === 0 || dim === 0) return null;

  const samples = labelled.filter((s) => dimOf(s) === dim).sort((a, b) => a.emailId - b.emailId);
  return { samples, dim, featureCount: samples[0]!.input.features.length };
}

function hasEnoughData(samples: readonly TrainingSample[]): boolean {
  if (samples.length < MIN_SAMPLES) return false;
  const perClass = new Map<string, number>();
  for (const s of samples) perClass.set(s.label, (perClass.get(s.label) ?? 0) + 1);
  return [...perClass.values()].filter((count) => count >= MIN_PER_CLASS).length >= 2;
}

/** Stratified 80/20 split with a seeded shuffle. */
function split(
  samples: readonly TrainingSample[],
  rng: () => number,
): { train: TrainingSample[]; holdout: TrainingSample[] } {
  const byLabel = new Map<string, TrainingSample[]>();
  for (const s of samples) {
    const group = byLabel.get(s.label);
    if (group) group.push(s);
    else byLabel.set(s.label, [s]);
  }
  const train: TrainingSample[] = [];
  const holdout: TrainingSample[] = [];
  for (const label of [...byLabel.keys()].sort()) {
    const group = byLabel.get(label)!;
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [group[i], group[j]] = [group[j]!, group[i]!];
    }
    const held = group.length >= 2 ? Math.max(1, Math.round(group.length * HOLDOUT_FRACTION)) : 0;
    holdout.push(...group.slice(0, held));
    train.push(...group.slice(held));
  }
  return { train, holdout };
}

const concat = (s: TrainingSample): number[] => [
  ...Array.from(s.input.embedding),
  ...s.input.features,
];

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
  return best;
}

async function trainQuestion(
  deps: Pick<Deps, 'system1Heads' | 'system1Training'>,
  question: Question,
  opts: { embeddingModel: string; epsilon: number; enabled: boolean; now: Date },
): Promise<void> {
  const labels = labelsOf(question);
  const raw = await deps.system1Training.listSamples(question.id, {
    embeddingModel: opts.embeddingModel,
  });
  const prepared = prepare(raw, labels);
  // Not enough evidence: leave whatever head exists exactly as it is.
  if (!prepared || !hasEnoughData(prepared.samples)) return;

  const labelIndex = new Map(labels.map((label, i) => [label, i]));
  const seed = fnv1a32(question.id);
  const { train, holdout } = split(prepared.samples, mulberry32(seed));

  const trainSamples: HeadSample[] = train.map((s) => ({
    x: concat(s),
    y: labelIndex.get(s.label)!,
    weight: s.gold ? GOLD_WEIGHT : 1,
  }));
  const { W, b } = trainHead(trainSamples, {
    classes: labels.length,
    inputDim: prepared.dim,
    seed,
  });

  const points = holdout.map((s) => {
    const p = predictProba(W, b, concat(s));
    return {
      confidence: entropyConfidence(p),
      correct: argmax(p) === labelIndex.get(s.label),
    };
  });
  const wrong = points.filter((p) => !p.correct).length;
  const selection = selectThreshold(points, { epsilon: opts.epsilon, alpha: BOUND_ALPHA });

  const metrics: HeadMetrics = {
    trainSize: train.length,
    holdoutSize: holdout.length,
    holdoutAgreement: points.length > 0 ? (points.length - wrong) / points.length : 0,
    coverage: selection?.coverage ?? 0,
    disagreementUpperBound:
      selection?.upperBound ?? clopperPearsonUpper(wrong, points.length, BOUND_ALPHA),
    auditCount: 0,
    auditAgreement: null,
  };
  const featureNames =
    prepared.featureCount === FEATURE_NAMES.length
      ? [...FEATURE_NAMES]
      : Array.from({ length: prepared.featureCount }, (_, i) => `f${i}`);

  await deps.system1Heads.save({
    questionId: question.id,
    embeddingModel: opts.embeddingModel,
    weights: toHeadWeights({
      questionId: question.id,
      kind: question.kind,
      labels,
      W,
      b,
      featureNames,
    }),
    // 1 is unreachable in practice; the head is unarmed anyway when there is no threshold.
    threshold: selection?.threshold ?? 1,
    armed: opts.enabled && selection !== null,
    metrics,
    trainedAt: opts.now,
  });
}

export const trainSystem1 =
  (deps: Pick<Deps, 'system1Heads' | 'system1Training' | 'embeddingService' | 'config'>) =>
  async (opts: { questionIds?: string[]; now?: Date } = {}): Promise<System1Status> => {
    const settings = readSystem1Settings(deps.config);
    const embeddingModel = deps.embeddingService.getModel();
    const now = opts.now ?? new Date();

    for (const question of QUESTIONS) {
      if (opts.questionIds && !opts.questionIds.includes(question.id)) continue;
      try {
        await trainQuestion(deps, question, {
          embeddingModel,
          epsilon: settings.targetDisagreement,
          enabled: settings.enabled,
          now,
        });
      } catch (error) {
        // One broken question must not stop the others from training.
        console.warn(`System 1: training the "${question.id}" head failed:`, error);
      }
    }
    return buildStatus(deps);
  };

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

async function applyAudit(
  deps: Pick<Deps, 'system1Heads' | 'config'>,
  audit: { questionId: string; version: number; agreed: boolean },
): Promise<void> {
  const head = await deps.system1Heads.getLatest(audit.questionId);
  // Audits of a superseded head say nothing about the current one.
  if (!head || head.version !== audit.version) return;

  const outcome = audit.agreed ? 1 : 0;
  const count = head.metrics.auditCount + 1;
  const previous = head.metrics.auditAgreement ?? outcome;
  const weight = Math.max(1 / count, AUDIT_EMA_ALPHA);
  const agreement = previous + weight * (outcome - previous);

  await deps.system1Heads.updateMetrics(audit.questionId, audit.version, {
    ...head.metrics,
    auditCount: count,
    auditAgreement: agreement,
  });

  const epsilon = readSystem1Settings(deps.config).targetDisagreement;
  if (head.armed && count >= MIN_AUDITS_FOR_DRIFT && agreement < 1 - 2 * epsilon) {
    console.warn(
      `System 1: "${audit.questionId}" head v${audit.version} disarmed (audit agreement ${agreement.toFixed(3)})`,
    );
    await deps.system1Heads.setArmed(audit.questionId, audit.version, false);
  }
}

export const recordSystem1Audit = (deps: Pick<Deps, 'system1Heads' | 'config'>) => {
  // Audits are a read-modify-write of one row: apply them one at a time.
  let queue: Promise<void> = Promise.resolve();
  return (opts: { questionId: string; version: number; agreed: boolean }): Promise<void> => {
    const run = queue.then(() => applyAudit(deps, opts));
    queue = run.catch(() => undefined);
    return run;
  };
};
