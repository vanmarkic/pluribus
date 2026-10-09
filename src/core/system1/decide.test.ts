import { describe, it, expect } from 'vitest';
import { answer, decide } from './decide';
import { EMAIL_QUESTIONS, type HeadRecord, type HeadWeights, type Question } from './types';
import { TRIAGE_FOLDERS } from '../domain';
import { predictProba } from './linear-head';
import { entropyConfidence } from './confidence';

/** Embedding dimension 2 + 1 scalar feature => inputDim 3. */
const input = { embedding: Float32Array.from([1, 0]), features: [0.5] };

function head(
  weights: Pick<HeadWeights, 'questionId' | 'kind' | 'labels' | 'W' | 'b'> & Partial<HeadWeights>,
  overrides: Partial<HeadRecord> = {},
): HeadRecord {
  return {
    questionId: weights.questionId,
    version: 3,
    embeddingModel: 'test-model',
    weights: { inputDim: 3, featureNames: ['f'], ...weights },
    threshold: 0.5,
    armed: true,
    metrics: {
      trainSize: 100,
      holdoutSize: 25,
      holdoutAgreement: 0.97,
      coverage: 0.8,
      disagreementUpperBound: 0.04,
      auditCount: 0,
      auditAgreement: null,
    },
    trainedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Logit gap `g` between the two classes, driven by the first embedding component. */
const noulHead = (gap: number, overrides: Partial<HeadRecord> = {}) =>
  head(
    {
      questionId: 'needsReply',
      kind: 'noul',
      labels: ['false', 'true'],
      W: [
        [0, 0, 0],
        [gap, 0, 0],
      ],
      b: [0, 0],
    },
    overrides,
  );

const scoreHead = (overrides: Partial<HeadRecord> = {}) =>
  head(
    {
      questionId: 'importance',
      kind: 'score',
      labels: ['1', '2', '3', '4'],
      W: [
        [0, 0, 0],
        [0, 0, 0],
        [6, 0, 0],
        [0, 0, 0],
      ],
      b: [0, 0, 0, 0],
    },
    overrides,
  );

const folderHead = (overrides: Partial<HeadRecord> = {}) =>
  head(
    {
      questionId: 'folder',
      kind: 'choice',
      labels: [...TRIAGE_FOLDERS],
      W: TRIAGE_FOLDERS.map((f) => (f === 'Feed' ? [8, 0, 0] : [0, 0, 0])),
      b: TRIAGE_FOLDERS.map(() => 0),
    },
    overrides,
  );

describe('answer: typed answers', () => {
  it('choice: value is the option label, probabilities are keyed by label', () => {
    const a = answer(EMAIL_QUESTIONS.folder, folderHead(), input);
    expect(a.kind).toBe('choice');
    if (a.kind !== 'choice') throw new Error('unreachable');
    expect(a.questionId).toBe('folder');
    expect(a.value).toBe('Feed');
    expect(Object.keys(a.probabilities).sort()).toEqual([...TRIAGE_FOLDERS].sort());
    expect(Object.values(a.probabilities).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
    expect(a.probabilities['Feed']!).toBeGreaterThan(0.99);
    expect(a.confidence).toBeCloseTo(entropyConfidence(Object.values(a.probabilities)), 12);
    expect(a.escalate).toBe(false);
  });

  it('score: value is the 1-based level with the most mass', () => {
    const a = answer(EMAIL_QUESTIONS.importance, scoreHead(), input);
    if (a.kind !== 'score') throw new Error('unreachable');
    expect(a.value).toBe(3);
    expect(a.probabilities).toHaveLength(4);
    expect(a.probabilities.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
    expect(a.escalate).toBe(false);
  });

  it('noul: value is p(true) >= 0.5 and probability is p(true)', () => {
    const yes = answer(EMAIL_QUESTIONS.needsReply, noulHead(5), input);
    if (yes.kind !== 'noul') throw new Error('unreachable');
    expect(yes.value).toBe(true);
    expect(yes.probability).toBeCloseTo(1 / (1 + Math.exp(-5)), 10);

    const no = answer(EMAIL_QUESTIONS.needsReply, noulHead(-5), input);
    if (no.kind !== 'noul') throw new Error('unreachable');
    expect(no.value).toBe(false);
    expect(no.probability).toBeLessThan(0.01);

    const tie = answer(EMAIL_QUESTIONS.needsReply, noulHead(0), input);
    if (tie.kind !== 'noul') throw new Error('unreachable');
    expect(tie.probability).toBeCloseTo(0.5, 12);
    expect(tie.value).toBe(true);
    expect(tie.confidence).toBeCloseTo(0, 12);
  });

  it('uses the same probabilities as predictProba on [embedding ++ features]', () => {
    const h = noulHead(2);
    const a = answer(EMAIL_QUESTIONS.needsReply, h, input);
    if (a.kind !== 'noul') throw new Error('unreachable');
    const p = predictProba(h.weights.W, h.weights.b, [1, 0, 0.5]);
    expect(a.probability).toBeCloseTo(p[1]!, 12);
  });
});

describe('answer: escalation', () => {
  it('escalates when the head is missing, with a neutral typed answer', () => {
    const choice = answer(EMAIL_QUESTIONS.folder, null, input);
    expect(choice).toMatchObject({ kind: 'choice', escalate: true, confidence: 0 });
    if (choice.kind !== 'choice') throw new Error('unreachable');
    expect(TRIAGE_FOLDERS).toContain(choice.value);
    expect(Object.values(choice.probabilities).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);

    const score = answer(EMAIL_QUESTIONS.importance, null, input);
    expect(score).toMatchObject({ kind: 'score', escalate: true, confidence: 0 });
    if (score.kind !== 'score') throw new Error('unreachable');
    expect(score.value).toBeGreaterThanOrEqual(1);
    expect(score.value).toBeLessThanOrEqual(4);
    expect(score.probabilities).toHaveLength(4);

    expect(answer(EMAIL_QUESTIONS.needsReply, null, input)).toMatchObject({
      kind: 'noul',
      escalate: true,
      confidence: 0,
      probability: 0.5,
    });
  });

  it('escalates an unarmed head but still reports its real answer (shadow mode)', () => {
    const a = answer(EMAIL_QUESTIONS.needsReply, noulHead(9, { armed: false }), input);
    if (a.kind !== 'noul') throw new Error('unreachable');
    expect(a.escalate).toBe(true);
    expect(a.value).toBe(true);
    expect(a.confidence).toBeGreaterThan(0.99);
  });

  it('escalates below the confidence threshold and accepts at or above it', () => {
    const h = noulHead(1); // p(true) ~ 0.73 -> confidence ~ 0.16
    const conf = (answer(EMAIL_QUESTIONS.needsReply, h, input) as { confidence: number })
      .confidence;
    expect(conf).toBeGreaterThan(0.1);
    expect(conf).toBeLessThan(0.3);

    expect(
      answer(EMAIL_QUESTIONS.needsReply, { ...h, threshold: conf + 0.01 }, input).escalate,
    ).toBe(true);
    expect(
      answer(EMAIL_QUESTIONS.needsReply, { ...h, threshold: conf - 0.01 }, input).escalate,
    ).toBe(false);
    // Exactly at the threshold counts as accepted (threshold = lowest accepted confidence).
    expect(answer(EMAIL_QUESTIONS.needsReply, { ...h, threshold: conf }, input).escalate).toBe(
      false,
    );
  });

  it('escalates on an input dimension mismatch', () => {
    const wrongEmbedding = { embedding: Float32Array.from([1, 0, 0]), features: [0.5] };
    const wrongFeatures = { embedding: Float32Array.from([1, 0]), features: [0.5, 0.5] };
    for (const bad of [wrongEmbedding, wrongFeatures]) {
      const a = answer(EMAIL_QUESTIONS.needsReply, noulHead(9), bad);
      expect(a.escalate).toBe(true);
    }
  });

  it('escalates when the head is for a different kind of question or has foreign labels', () => {
    expect(answer(EMAIL_QUESTIONS.importance, noulHead(9), input).escalate).toBe(true);
    expect(answer(EMAIL_QUESTIONS.needsReply, scoreHead(), input).escalate).toBe(true);
    expect(answer(EMAIL_QUESTIONS.folder, noulHead(9), input).escalate).toBe(true);

    const foreignFolder = folderHead();
    foreignFolder.weights = {
      ...foreignFolder.weights,
      labels: [...TRIAGE_FOLDERS.slice(1), 'Nope'],
    };
    expect(answer(EMAIL_QUESTIONS.folder, foreignFolder, input).escalate).toBe(true);

    const wrongLevels = scoreHead();
    wrongLevels.weights = {
      ...wrongLevels.weights,
      labels: ['1', '2', '3'],
      W: wrongLevels.weights.W.slice(0, 3),
      b: [0, 0, 0],
    };
    expect(answer(EMAIL_QUESTIONS.importance, wrongLevels, input).escalate).toBe(true);
  });

  it('escalates (never throws) on corrupted weights or non-finite inputs', () => {
    const ragged = noulHead(9);
    ragged.weights = { ...ragged.weights, W: [[0, 0, 0], [1]] };
    expect(answer(EMAIL_QUESTIONS.needsReply, ragged, input).escalate).toBe(true);

    const nan = answer(EMAIL_QUESTIONS.needsReply, noulHead(9), {
      embedding: Float32Array.from([Number.NaN, 0]),
      features: [0.5],
    });
    expect(nan.escalate).toBe(true);
    if (nan.kind !== 'noul') throw new Error('unreachable');
    expect(Number.isFinite(nan.probability)).toBe(true);
    expect(Number.isFinite(nan.confidence)).toBe(true);
  });

  it('also escalates a custom question with an unknown head', () => {
    const q: Question = { kind: 'choice', id: 'custom', options: ['a', 'b'] };
    expect(answer(q, null, input)).toMatchObject({
      kind: 'choice',
      questionId: 'custom',
      value: 'a',
      escalate: true,
    });
  });
});

describe('decide', () => {
  it('answers each question from its own head, in question order', () => {
    const answers = decide(
      [EMAIL_QUESTIONS.folder, EMAIL_QUESTIONS.needsReply, EMAIL_QUESTIONS.importance],
      { folder: folderHead(), needsReply: noulHead(9), importance: scoreHead() },
      input,
    );
    expect(answers.map((a) => a.questionId)).toEqual(['folder', 'needsReply', 'importance']);
    expect(answers.map((a) => a.kind)).toEqual(['choice', 'noul', 'score']);
    expect(answers.every((a) => !a.escalate)).toBe(true);
  });

  it('escalates questions whose head is absent or null', () => {
    const answers = decide(
      [EMAIL_QUESTIONS.folder, EMAIL_QUESTIONS.needsReply, EMAIL_QUESTIONS.importance],
      { needsReply: noulHead(9), importance: null },
      input,
    );
    expect(answers.map((a) => a.escalate)).toEqual([true, false, true]);
  });

  it("does not use another question's head under the wrong id", () => {
    const answers = decide([EMAIL_QUESTIONS.needsReply], { needsReply: scoreHead() }, input);
    expect(answers[0]!.escalate).toBe(true);
  });
});
