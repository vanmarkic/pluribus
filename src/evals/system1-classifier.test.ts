import { describe, it, expect, vi } from 'vitest';
import {
  createSystem1EvalClassifier,
  trainCentroidHead,
  assignFolds,
  type HeadTrainer,
} from './system1-classifier';
import { runEval } from './runner';
import { DATASET } from './dataset';
import { system1Text } from '../core/system1/text';
import type { EvalEntry } from './types';

/**
 * Deterministic fake encoder: hashes words into a small vector. Mails of one
 * folder share vocabulary, so a head can learn them; no model, no network.
 */
const DIM = 64;
function hashWord(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % DIM;
}
async function fakeEmbed(text: string): Promise<number[]> {
  const v = new Array<number>(DIM).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    v[hashWord(word)]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const mk = (
  id: string,
  folder: EvalEntry['expectedFolder'],
  text: string,
  lang: 'fr' | 'en' = 'fr',
): EvalEntry => ({
  id,
  from: { address: `${id}@example.com`, name: id },
  subject: text,
  body: text,
  expectedFolder: folder,
  lang,
});

/** Two clearly separable classes, 8 emails each. */
const SEPARABLE: EvalEntry[] = [
  ...Array.from({ length: 8 }, (_, i) =>
    mk(`inv-${i}`, 'Paper-Trail/Invoices', `facture paiement montant total ${i}`),
  ),
  ...Array.from({ length: 8 }, (_, i) =>
    mk(`soc-${i}`, 'Social', `abonne commente profil photo ${i}`),
  ),
];

describe('assignFolds', () => {
  it('splits into k balanced folds, each entry in exactly one', () => {
    const folds = assignFolds(
      SEPARABLE.map((e) => e.expectedFolder),
      4,
      7,
    );
    expect(folds).toHaveLength(SEPARABLE.length);
    const sizes = [0, 1, 2, 3].map((f) => folds.filter((x) => x === f).length);
    expect(sizes).toEqual([4, 4, 4, 4]);
  });

  it('stratifies: every fold sees both classes', () => {
    const labels = SEPARABLE.map((e) => e.expectedFolder);
    const folds = assignFolds(labels, 4, 7);
    for (let f = 0; f < 4; f++) {
      const inFold = new Set(labels.filter((_, i) => folds[i] === f));
      expect(inFold.size).toBe(2);
    }
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const labels = SEPARABLE.map((e) => e.expectedFolder);
    expect(assignFolds(labels, 4, 1)).toEqual(assignFolds(labels, 4, 1));
    expect(assignFolds(labels, 4, 1)).not.toEqual(assignFolds(labels, 4, 2));
  });

  it('never makes more folds than entries', () => {
    const folds = assignFolds(['Feed', 'Feed', 'Social'], 4, 1);
    expect(new Set(folds).size).toBe(3);
  });
});

describe('trainCentroidHead', () => {
  const samples = [
    { x: [1, 0], label: 'Feed' as const },
    { x: [0.9, 0.1], label: 'Feed' as const },
    { x: [0, 1], label: 'Social' as const },
    { x: [0.1, 0.9], label: 'Social' as const },
  ];

  it('predicts the nearest class with a confidence in [0, 1]', () => {
    const predict = trainCentroidHead(samples);
    const near = predict([0.95, 0.05]);
    expect(near.folder).toBe('Feed');
    expect(near.confidence).toBeGreaterThan(0);
    expect(near.confidence).toBeLessThanOrEqual(1);
    expect(predict([0.05, 0.95]).folder).toBe('Social');
  });

  it('is less sure in the middle than at a centroid', () => {
    const predict = trainCentroidHead(samples);
    expect(predict([0.7071, 0.7071]).confidence).toBeLessThan(predict([1, 0]).confidence);
  });

  it('copes with a class that has a single example', () => {
    const predict = trainCentroidHead([
      { x: [1, 0], label: 'Feed' },
      { x: [0, 1], label: 'Social' },
    ]);
    expect(predict([1, 0]).folder).toBe('Feed');
  });
});

describe('createSystem1EvalClassifier', () => {
  it('embeds every entry once, with the canonical System 1 text', async () => {
    const embed = vi.fn(fakeEmbed);
    await createSystem1EvalClassifier(SEPARABLE, { embed });

    expect(embed).toHaveBeenCalledTimes(SEPARABLE.length);
    const first = SEPARABLE[0]!;
    expect(embed).toHaveBeenCalledWith(
      system1Text(
        {
          subject: first.subject,
          from: { address: first.from.address, name: first.from.name ?? null },
        },
        first.body,
      ),
    );
    // The encoder service owns the e5 "query: " prefix, not the eval harness.
    for (const [text] of embed.mock.calls) expect(text).not.toMatch(/^query: /);
  });

  it('k-fold (k=4): every entry is predicted by a head that never saw it', async () => {
    const trained: string[][] = [];
    const trainer: HeadTrainer = (samples) => {
      trained.push(samples.map((s) => s.id));
      return () => ({ folder: 'INBOX', confidence: 0.5 });
    };
    const classifier = await createSystem1EvalClassifier(SEPARABLE, { embed: fakeEmbed, trainer });

    expect(trained).toHaveLength(4); // one head per fold
    // Each head trained on exactly the entries outside its fold: 3/4 of them.
    for (const ids of trained) expect(ids).toHaveLength(12);
    // Every entry is missing from exactly one head's training set.
    for (const entry of SEPARABLE) {
      expect(trained.filter((ids) => !ids.includes(entry.id))).toHaveLength(1);
    }
    expect((await classifier.classify(SEPARABLE[0]!)).folder).toBe('INBOX');
  });

  it('learns separable classes from the other folds', async () => {
    const classifier = await createSystem1EvalClassifier(SEPARABLE, { embed: fakeEmbed });
    const report = await runEval(classifier, SEPARABLE);
    expect(report.accuracy).toBe(1);
    expect(report.selective?.accuracyAtCoverage['0.5']).toBe(1);
  });

  it('is deterministic for a seed', async () => {
    const a = await createSystem1EvalClassifier(DATASET, { embed: fakeEmbed, seed: 3 });
    const b = await createSystem1EvalClassifier(DATASET, { embed: fakeEmbed, seed: 3 });
    for (const entry of DATASET.slice(0, 20)) {
      const [x, y] = await Promise.all([a.classify(entry), b.classify(entry)]);
      expect(x.folder).toBe(y.folder);
      expect(x.confidence).toBe(y.confidence);
    }
  });

  it('runs over the real dataset and reports accuracy per language', async () => {
    const classifier = await createSystem1EvalClassifier(DATASET, { embed: fakeEmbed });
    const report = await runEval(classifier, DATASET);

    expect(report.total).toBe(DATASET.length);
    expect(report.byLanguage?.['fr']?.total).toBeGreaterThan(0);
    expect(report.byLanguage?.['en']?.total).toBeGreaterThan(0);
    // A hashed bag-of-words "encoder" is weak, but out-of-fold it must still beat
    // guessing (the biggest folder holds about 12% of the entries).
    expect(report.accuracy).toBeGreaterThan(0.2);
    expect(report.selective?.ece).toBeGreaterThanOrEqual(0);
    expect(report.classifier).toMatch(/system1/i);
    for (const result of [await classifier.classify(DATASET[0]!)]) {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.costUsd).toBe(0);
    }
  });

  it('puts the model in the label so runs can be compared', async () => {
    const classifier = await createSystem1EvalClassifier(SEPARABLE, {
      embed: fakeEmbed,
      modelLabel: 'Xenova/multilingual-e5-small',
    });
    expect(classifier.label).toContain('Xenova/multilingual-e5-small');
  });

  it('reports embedding time as latency', async () => {
    const slow = async (text: string) => {
      await new Promise((r) => setTimeout(r, 2));
      return fakeEmbed(text);
    };
    const classifier = await createSystem1EvalClassifier(SEPARABLE.slice(0, 8), { embed: slow });
    const result = await classifier.classify(SEPARABLE[0]!);
    expect(result.latencyMs).toBeGreaterThanOrEqual(1);
  });

  it('refuses an entry that was not in the dataset it was built from', async () => {
    const classifier = await createSystem1EvalClassifier(SEPARABLE, { embed: fakeEmbed });
    await expect(classifier.classify(mk('stranger', 'Feed', 'hello'))).rejects.toThrow(
      /not in the eval set/,
    );
  });

  it('needs at least two entries', async () => {
    await expect(createSystem1EvalClassifier([], { embed: fakeEmbed })).rejects.toThrow(/at least/);
  });

  it('propagates an encoder failure instead of silently scoring garbage', async () => {
    const broken = async () => {
      throw new Error('model not downloaded');
    };
    await expect(createSystem1EvalClassifier(SEPARABLE, { embed: broken })).rejects.toThrow(
      'model not downloaded',
    );
  });
});
