import { describe, it, expect, vi } from 'vitest';
import { getSystem1Status, recordSystem1Audit, trainSystem1 } from './system1-usecases';
import { mulberry32 } from '../system1/linear-head';
import { predictProba } from '../system1/linear-head';
import { DEFAULT_SYSTEM1_SETTINGS, TRIAGE_FOLDERS, type System1Settings } from '../domain';
import type { ConfigStore, System1HeadRepo, System1TrainingRepo } from '../ports';
import type { HeadMetrics, HeadRecord, TrainingSample } from '../system1/types';

const MODEL = 'test-encoder';
const DIM = 12;
const NOW = new Date('2026-10-09T08:00:00.000Z');

// ---- synthetic data ----

function gaussian(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}

function centroid(seed: number): number[] {
  const rng = mulberry32(seed);
  const v = Array.from({ length: DIM }, () => gaussian(rng));
  const norm = Math.sqrt(v.reduce((s, a) => s + a * a, 0));
  return v.map((a) => a / norm);
}

type Spec = { label: string; center: number[]; count: number; gold?: boolean; noise?: number };

function sampleSet(specs: Spec[], seed = 5, startId = 1): TrainingSample[] {
  const rng = mulberry32(seed);
  let id = startId;
  const out: TrainingSample[] = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      out.push({
        emailId: id++,
        label: spec.label,
        gold: spec.gold ?? false,
        input: {
          embedding: Float32Array.from(
            spec.center.map((c) => c + gaussian(rng) * (spec.noise ?? 0.05)),
          ),
          features: [0, 1, 0],
        },
      });
    }
  }
  return out;
}

const cleanNeedsReply = (perClass = 300): TrainingSample[] =>
  sampleSet([
    { label: 'false', center: centroid(1), count: perClass },
    { label: 'true', center: centroid(2), count: perClass },
  ]);

// ---- fakes ----

function fakeHeadRepo(initial: HeadRecord[] = []) {
  const rows: HeadRecord[] = [...initial];
  const repo: System1HeadRepo = {
    save: vi.fn(async (record) => {
      const version =
        Math.max(
          0,
          ...rows.filter((r) => r.questionId === record.questionId).map((r) => r.version),
        ) + 1;
      const saved = { ...record, version };
      rows.push(saved);
      return saved;
    }),
    getLatest: vi.fn(async (questionId) => {
      const mine = rows.filter((r) => r.questionId === questionId);
      return mine.sort((a, b) => b.version - a.version)[0] ?? null;
    }),
    setArmed: vi.fn(async (questionId, version, armed) => {
      const row = rows.find((r) => r.questionId === questionId && r.version === version);
      if (row) row.armed = armed;
    }),
    updateMetrics: vi.fn(async (questionId, version, metrics) => {
      const row = rows.find((r) => r.questionId === questionId && r.version === version);
      if (row) row.metrics = metrics;
    }),
  };
  return { repo, rows };
}

function fakeTraining(byQuestion: Record<string, TrainingSample[]>) {
  const listSamples = vi.fn(async (questionId: string) => byQuestion[questionId] ?? []);
  const repo: System1TrainingRepo = { listSamples };
  return { repo, listSamples };
}

function fakeConfig(settings: Partial<System1Settings> = {}): ConfigStore {
  return {
    getSystem1Settings: () => ({ ...DEFAULT_SYSTEM1_SETTINGS, ...settings }),
  } as ConfigStore;
}

function makeDeps(opts: {
  samples?: Record<string, TrainingSample[]>;
  heads?: HeadRecord[];
  settings?: Partial<System1Settings>;
}) {
  const heads = fakeHeadRepo(opts.heads);
  const training = fakeTraining(opts.samples ?? {});
  const deps = {
    system1Heads: heads.repo,
    system1Training: training.repo,
    embeddingService: { getModel: () => MODEL } as never,
    config: fakeConfig(opts.settings),
  };
  return { deps, heads, training };
}

function metrics(overrides: Partial<HeadMetrics> = {}): HeadMetrics {
  return {
    trainSize: 200,
    holdoutSize: 50,
    holdoutAgreement: 0.97,
    coverage: 0.8,
    disagreementUpperBound: 0.04,
    auditCount: 0,
    auditAgreement: null,
    ...overrides,
  };
}

function existingHead(overrides: Partial<HeadRecord> = {}): HeadRecord {
  return {
    questionId: 'needsReply',
    version: 1,
    embeddingModel: MODEL,
    weights: {
      questionId: 'needsReply',
      kind: 'noul',
      labels: ['false', 'true'],
      inputDim: 2,
      W: [
        [1, 0],
        [0, 1],
      ],
      b: [0, 0],
      featureNames: [],
    },
    threshold: 0.5,
    armed: true,
    metrics: metrics(),
    trainedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

// ---- tests ----

describe('trainSystem1', () => {
  it('asks the training repo for samples of the current embedding model, per question', async () => {
    const { deps, training } = makeDeps({});
    await trainSystem1(deps)({ now: NOW });
    expect(training.listSamples).toHaveBeenCalledTimes(3);
    for (const id of ['folder', 'needsReply', 'importance']) {
      expect(training.listSamples).toHaveBeenCalledWith(id, { embeddingModel: MODEL });
    }
  });

  it('never arms (or even saves) a head with too little data', async () => {
    const { deps, heads } = makeDeps({ samples: { needsReply: cleanNeedsReply(20) } }); // 40 samples
    const status = await trainSystem1(deps)({ now: NOW });
    expect(heads.repo.save).not.toHaveBeenCalled();
    const s = status.heads.find((h) => h.questionId === 'needsReply')!;
    expect(s).toMatchObject({ armed: false, version: null, trainedAt: null });
  });

  it('does not train when fewer than two classes have at least five examples', async () => {
    const samples = sampleSet([
      { label: 'false', center: centroid(1), count: 120 },
      { label: 'true', center: centroid(2), count: 4 },
    ]);
    const { deps, heads } = makeDeps({ samples: { needsReply: samples } });
    await trainSystem1(deps)({ now: NOW });
    expect(heads.repo.save).not.toHaveBeenCalled();
  });

  it('keeps an existing head untouched when there is not enough data to retrain', async () => {
    const { deps, heads } = makeDeps({
      samples: { needsReply: cleanNeedsReply(10) },
      heads: [existingHead()],
    });
    const status = await trainSystem1(deps)({ now: NOW });
    expect(heads.repo.save).not.toHaveBeenCalled();
    expect(status.heads.find((h) => h.questionId === 'needsReply')).toMatchObject({
      armed: true,
      version: 1,
    });
  });

  it('saves an unarmed head when the holdout is too small to bound the risk', async () => {
    // 100 samples -> 20 holdout < 30 minimum accepted: shadow only.
    const { deps, heads } = makeDeps({ samples: { needsReply: cleanNeedsReply(50) } });
    await trainSystem1(deps)({ now: NOW });
    expect(heads.repo.save).toHaveBeenCalledTimes(1);
    const saved = heads.rows[0]!;
    expect(saved.armed).toBe(false);
    expect(saved.metrics.trainSize + saved.metrics.holdoutSize).toBe(100);
    expect(saved.metrics.holdoutSize).toBe(20);
    expect(saved.threshold).toBeGreaterThan(0);
  });

  it('arms a head trained on clean, separable data and fills in its metrics', async () => {
    const { deps, heads } = makeDeps({ samples: { needsReply: cleanNeedsReply() } });
    const status = await trainSystem1(deps)({ now: NOW });

    expect(heads.rows).toHaveLength(1);
    const head = heads.rows[0]!;
    expect(head).toMatchObject({
      questionId: 'needsReply',
      version: 1,
      embeddingModel: MODEL,
      armed: true,
      trainedAt: NOW,
    });
    expect(head.weights).toMatchObject({
      questionId: 'needsReply',
      kind: 'noul',
      labels: ['false', 'true'],
      inputDim: DIM + 3,
    });
    expect(head.weights.W).toHaveLength(2);
    expect(head.weights.W[0]).toHaveLength(DIM + 3);
    expect(head.metrics.trainSize).toBe(480);
    expect(head.metrics.holdoutSize).toBe(120);
    expect(head.metrics.holdoutAgreement).toBeGreaterThanOrEqual(0.97);
    expect(head.metrics.coverage).toBeGreaterThan(0.9);
    expect(head.metrics.disagreementUpperBound).toBeLessThanOrEqual(0.05);
    expect(head.metrics.auditCount).toBe(0);
    expect(head.metrics.auditAgreement).toBeNull();
    expect(JSON.parse(JSON.stringify(head.weights))).toEqual(head.weights);

    expect(status.embeddingModel).toBe(MODEL);
    const s = status.heads.find((h) => h.questionId === 'needsReply')!;
    expect(s).toMatchObject({ armed: true, version: 1, trainSize: 480, trainedAt: NOW });
    expect(s.coverage).toBe(head.metrics.coverage);
    expect(s.agreement).toBe(head.metrics.holdoutAgreement);
    expect(s.disagreementUpperBound).toBe(head.metrics.disagreementUpperBound);
  });

  it('does not arm when the labels cannot be predicted well enough to bound the risk', async () => {
    // Both classes live in the same place: no confidence level is reliable.
    const samples = sampleSet([
      { label: 'false', center: centroid(1), count: 300, noise: 0.3 },
      { label: 'true', center: centroid(1), count: 300, noise: 0.3 },
    ]);
    const { deps, heads } = makeDeps({ samples: { needsReply: samples } });
    await trainSystem1(deps)({ now: NOW });
    expect(heads.rows[0]!.armed).toBe(false);
    expect(heads.rows[0]!.metrics.disagreementUpperBound).toBeGreaterThan(0.05);
  });

  it('respects the configured target disagreement', async () => {
    // Slightly overlapping classes: arms at a loose epsilon, not at a strict one.
    const samples = sampleSet([
      { label: 'false', center: centroid(1), count: 400, noise: 0.28 },
      { label: 'true', center: centroid(2), count: 400, noise: 0.28 },
    ]);
    const strict = makeDeps({
      samples: { needsReply: samples },
      settings: { targetDisagreement: 0.01 },
    });
    const loose = makeDeps({
      samples: { needsReply: samples },
      settings: { targetDisagreement: 0.2 },
    });
    await trainSystem1(strict.deps)({ now: NOW });
    await trainSystem1(loose.deps)({ now: NOW });
    expect(loose.heads.rows[0]!.armed).toBe(true);
    expect(loose.heads.rows[0]!.metrics.disagreementUpperBound).toBeLessThanOrEqual(0.2);
    if (strict.heads.rows[0]!.armed) {
      expect(strict.heads.rows[0]!.metrics.disagreementUpperBound).toBeLessThanOrEqual(0.01);
    }
    expect(loose.heads.rows[0]!.metrics.coverage).toBeGreaterThanOrEqual(
      strict.heads.rows[0]!.metrics.coverage,
    );
  });

  it('saves the head unarmed when System 1 is disabled', async () => {
    const { deps, heads } = makeDeps({
      samples: { needsReply: cleanNeedsReply() },
      settings: { enabled: false },
    });
    await trainSystem1(deps)({ now: NOW });
    expect(heads.rows[0]!.armed).toBe(false);
    expect(heads.rows[0]!.metrics.coverage).toBeGreaterThan(0.9);
  });

  it('gives gold labels more weight than teacher labels on the same input', async () => {
    const conflict = centroid(3);
    const samples = [
      ...cleanNeedsReply(150),
      // Same spot: 40 teacher says false, 40 user says true. Weight 3 on gold must win.
      ...sampleSet([{ label: 'false', center: conflict, count: 40, noise: 0.01 }], 11, 10_000),
      ...sampleSet(
        [{ label: 'true', center: conflict, count: 40, gold: true, noise: 0.01 }],
        12,
        20_000,
      ),
    ];
    const { deps, heads } = makeDeps({ samples: { needsReply: samples } });
    await trainSystem1(deps)({ now: NOW });

    const w = heads.rows[0]!.weights;
    const x = [...conflict, 0, 1, 0];
    const p = predictProba(w.W, w.b, x);
    expect(p[1]!).toBeGreaterThan(0.5);

    // Control: with the same labels but no gold flag, the two sides tie and gold has no edge.
    const noGold = samples.map((s) => ({ ...s, gold: false }));
    const control = makeDeps({ samples: { needsReply: noGold } });
    await trainSystem1(control.deps)({ now: NOW });
    const cw = control.heads.rows[0]!.weights;
    const pc = predictProba(cw.W, cw.b, x);
    expect(p[1]!).toBeGreaterThan(pc[1]!);
  });

  it('is deterministic: same samples in any order give the same head', async () => {
    const samples = cleanNeedsReply(100);
    const a = makeDeps({ samples: { needsReply: samples } });
    const b = makeDeps({ samples: { needsReply: [...samples].reverse() } });
    await trainSystem1(a.deps)({ now: NOW });
    await trainSystem1(b.deps)({ now: NOW });
    expect(b.heads.rows[0]!.weights).toEqual(a.heads.rows[0]!.weights);
    expect(b.heads.rows[0]!.threshold).toBe(a.heads.rows[0]!.threshold);
  });

  it('trains the folder head over the triage folders and ignores unknown labels', async () => {
    const folders = ['INBOX', 'Feed', 'Promotions'] as const;
    const samples = [
      ...folders.flatMap((f, i) =>
        sampleSet([{ label: f, center: centroid(40 + i), count: 150 }], 20 + i, 1 + i * 1000),
      ),
      ...sampleSet([{ label: 'NotAFolder', center: centroid(99), count: 80 }], 30, 50_000),
    ];
    const { deps, heads } = makeDeps({ samples: { folder: samples } });
    await trainSystem1(deps)({ questionIds: ['folder'], now: NOW });

    const head = heads.rows[0]!;
    expect(head.weights.kind).toBe('choice');
    expect(head.weights.labels).toEqual([...TRIAGE_FOLDERS]);
    expect(head.weights.labels).not.toContain('NotAFolder');
    expect(head.metrics.trainSize + head.metrics.holdoutSize).toBe(450);
    expect(head.armed).toBe(true);
  });

  it('trains the importance head as a four-level score', async () => {
    const samples = ['1', '2', '3', '4'].flatMap((label, i) =>
      sampleSet([{ label, center: centroid(60 + i), count: 100 }], 40 + i, 1 + i * 1000),
    );
    const { deps, heads } = makeDeps({ samples: { importance: samples } });
    await trainSystem1(deps)({ questionIds: ['importance'], now: NOW });
    expect(heads.rows[0]!.weights).toMatchObject({ kind: 'score', labels: ['1', '2', '3', '4'] });
    expect(heads.rows[0]!.armed).toBe(true);
  });

  it('only trains the requested questions', async () => {
    const { deps, training, heads } = makeDeps({ samples: { needsReply: cleanNeedsReply() } });
    const status = await trainSystem1(deps)({ questionIds: ['needsReply'], now: NOW });
    expect(training.listSamples).toHaveBeenCalledTimes(1);
    expect(heads.rows).toHaveLength(1);
    // Status still reports every question.
    expect(status.heads.map((h) => h.questionId).sort()).toEqual([
      'folder',
      'importance',
      'needsReply',
    ]);
  });

  it('versions a retrained head and supersedes the previous one', async () => {
    const { deps, heads } = makeDeps({ samples: { needsReply: cleanNeedsReply() } });
    await trainSystem1(deps)({ now: NOW });
    const status = await trainSystem1(deps)({ now: new Date(NOW.getTime() + 86_400_000) });
    expect(heads.rows.map((r) => r.version)).toEqual([1, 2]);
    expect(status.heads.find((h) => h.questionId === 'needsReply')!.version).toBe(2);
  });

  it('drops samples whose embedding dimension differs from the majority', async () => {
    const odd: TrainingSample = {
      emailId: 99_999,
      label: 'true',
      gold: false,
      input: { embedding: new Float32Array(DIM + 5), features: [0, 1, 0] },
    };
    const { deps, heads } = makeDeps({ samples: { needsReply: [...cleanNeedsReply(100), odd] } });
    await trainSystem1(deps)({ now: NOW });
    expect(heads.rows[0]!.metrics.trainSize + heads.rows[0]!.metrics.holdoutSize).toBe(200);
  });
});

describe('getSystem1Status', () => {
  it('reports every question as untrained when there are no heads', async () => {
    const { deps } = makeDeps({});
    const status = await getSystem1Status(deps)();
    expect(status.embeddingModel).toBe(MODEL);
    expect(status.heads.map((h) => h.questionId)).toEqual(['folder', 'needsReply', 'importance']);
    for (const h of status.heads) {
      expect(h).toEqual({
        questionId: h.questionId,
        armed: false,
        version: null,
        coverage: null,
        agreement: null,
        disagreementUpperBound: null,
        trainSize: 0,
        trainedAt: null,
      });
    }
  });

  it('reflects the latest head per question', async () => {
    const { deps } = makeDeps({
      heads: [
        existingHead({ version: 1, armed: false }),
        existingHead({
          version: 2,
          armed: true,
          metrics: metrics({
            trainSize: 321,
            coverage: 0.66,
            holdoutAgreement: 0.95,
            disagreementUpperBound: 0.045,
          }),
        }),
      ],
    });
    const status = await getSystem1Status(deps)();
    expect(status.heads.find((h) => h.questionId === 'needsReply')).toEqual({
      questionId: 'needsReply',
      armed: true,
      version: 2,
      coverage: 0.66,
      agreement: 0.95,
      disagreementUpperBound: 0.045,
      trainSize: 321,
      trainedAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(status.heads.find((h) => h.questionId === 'folder')!.version).toBeNull();
  });

  it('does not report a head trained on another encoder as armed', async () => {
    const { deps } = makeDeps({ heads: [existingHead({ embeddingModel: 'older-encoder' })] });
    const status = await getSystem1Status(deps)();
    expect(status.heads.find((h) => h.questionId === 'needsReply')).toMatchObject({
      armed: false,
      version: 1,
    });
  });
});

describe('recordSystem1Audit', () => {
  const audit = (deps: ReturnType<typeof makeDeps>['deps']) => recordSystem1Audit(deps);

  it('initialises the rolling agreement from the first audit', async () => {
    const { deps, heads } = makeDeps({ heads: [existingHead()] });
    await audit(deps)({ questionId: 'needsReply', version: 1, agreed: true });
    expect(heads.rows[0]!.metrics).toMatchObject({ auditCount: 1, auditAgreement: 1 });
    expect(heads.rows[0]!.armed).toBe(true);

    const second = makeDeps({ heads: [existingHead()] });
    await audit(second.deps)({ questionId: 'needsReply', version: 1, agreed: false });
    expect(second.heads.rows[0]!.metrics).toMatchObject({ auditCount: 1, auditAgreement: 0 });
  });

  it('keeps the other metrics intact', async () => {
    const { deps, heads } = makeDeps({ heads: [existingHead()] });
    await audit(deps)({ questionId: 'needsReply', version: 1, agreed: true });
    expect(heads.rows[0]!.metrics).toMatchObject({
      trainSize: 200,
      holdoutSize: 50,
      coverage: 0.8,
      disagreementUpperBound: 0.04,
    });
  });

  it('disarms the head after 20 audits with a low rolling agreement (drift)', async () => {
    const { deps, heads } = makeDeps({ heads: [existingHead()] });
    for (let i = 0; i < 19; i++) {
      await audit(deps)({ questionId: 'needsReply', version: 1, agreed: i % 2 === 0 });
    }
    expect(heads.rows[0]!.armed).toBe(true); // below 20 audits: never disarm
    await audit(deps)({ questionId: 'needsReply', version: 1, agreed: false });
    expect(heads.rows[0]!.metrics.auditCount).toBe(20);
    expect(heads.rows[0]!.metrics.auditAgreement!).toBeLessThan(0.9);
    expect(heads.rows[0]!.armed).toBe(false);
    expect(heads.repo.setArmed).toHaveBeenCalledWith('needsReply', 1, false);
  });

  it('keeps the head armed when agreement stays good', async () => {
    const { deps, heads } = makeDeps({ heads: [existingHead()] });
    for (let i = 0; i < 40; i++) {
      await audit(deps)({ questionId: 'needsReply', version: 1, agreed: i !== 7 && i !== 23 });
    }
    expect(heads.rows[0]!.metrics.auditCount).toBe(40);
    expect(heads.rows[0]!.metrics.auditAgreement!).toBeGreaterThan(0.9);
    expect(heads.rows[0]!.armed).toBe(true);
    expect(heads.repo.setArmed).not.toHaveBeenCalled();
  });

  it('uses 1 - 2*epsilon from the settings as the drift line', async () => {
    // 85% agreement: fine at epsilon 0.1 (line 0.8), drift at epsilon 0.05 (line 0.9).
    const run = async (targetDisagreement: number) => {
      const { deps, heads } = makeDeps({
        heads: [existingHead()],
        settings: { targetDisagreement },
      });
      for (let i = 0; i < 20; i++) {
        await audit(deps)({ questionId: 'needsReply', version: 1, agreed: i % 20 >= 3 });
      }
      return heads.rows[0]!.armed;
    };
    expect(await run(0.1)).toBe(true);
    expect(await run(0.05)).toBe(false);
  });

  it('turns into a rolling window: old audits fade out', async () => {
    const { deps, heads } = makeDeps({ heads: [existingHead({ armed: false })] });
    for (let i = 0; i < 30; i++)
      await audit(deps)({ questionId: 'needsReply', version: 1, agreed: false });
    expect(heads.rows[0]!.metrics.auditAgreement).toBe(0);
    for (let i = 0; i < 300; i++)
      await audit(deps)({ questionId: 'needsReply', version: 1, agreed: true });
    expect(heads.rows[0]!.metrics.auditAgreement!).toBeGreaterThan(0.99);
  });

  it('ignores audits for a version that is no longer the latest', async () => {
    const { deps, heads } = makeDeps({
      heads: [existingHead({ version: 1 }), existingHead({ version: 2 })],
    });
    await audit(deps)({ questionId: 'needsReply', version: 1, agreed: false });
    expect(heads.repo.updateMetrics).not.toHaveBeenCalled();
    expect(heads.rows.every((r) => r.metrics.auditCount === 0)).toBe(true);
  });

  it('ignores audits for an unknown head', async () => {
    const { deps, heads } = makeDeps({});
    await expect(
      audit(deps)({ questionId: 'needsReply', version: 1, agreed: false }),
    ).resolves.toBeUndefined();
    expect(heads.repo.updateMetrics).not.toHaveBeenCalled();
  });

  it('does not lose audits that arrive concurrently', async () => {
    const { deps, heads } = makeDeps({ heads: [existingHead()] });
    // Make reads slow so unsynchronised read-modify-write would interleave.
    const getLatest = heads.repo.getLatest;
    heads.repo.getLatest = vi.fn(async (q) => {
      await new Promise((r) => setTimeout(r, 1));
      return getLatest(q);
    });
    const record = audit(deps);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        record({ questionId: 'needsReply', version: 1, agreed: i % 5 !== 0 }),
      ),
    );
    expect(heads.rows[0]!.metrics.auditCount).toBe(25);
  });
});
