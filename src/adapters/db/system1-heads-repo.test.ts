/**
 * System 1 Heads Repository Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { createSystem1HeadRepo } from './system1-heads-repo';
import { getDb, initDb, closeDb } from './connection';
import type { HeadMetrics, HeadRecord, HeadWeights } from '../../core/system1/types';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function weights(questionId = 'needsReply'): HeadWeights {
  return {
    questionId,
    kind: 'noul',
    labels: ['false', 'true'],
    inputDim: 3,
    W: [
      [0.125, -0.5, 1e-7],
      [-0.125, 0.5, -1e-7],
    ],
    b: [0.25, -0.25],
    featureNames: ['hasQuestionMark'],
  };
}

function metrics(overrides: Partial<HeadMetrics> = {}): HeadMetrics {
  return {
    trainSize: 200,
    holdoutSize: 50,
    holdoutAgreement: 0.94,
    coverage: 0.62,
    disagreementUpperBound: 0.08,
    auditCount: 0,
    auditAgreement: null,
    ...overrides,
  };
}

function record(
  questionId = 'needsReply',
  overrides: Partial<Omit<HeadRecord, 'version'>> = {},
): Omit<HeadRecord, 'version'> {
  return {
    questionId,
    embeddingModel: 'all-MiniLM-L6-v2',
    weights: weights(questionId),
    threshold: 0.8,
    armed: false,
    metrics: metrics(),
    trainedAt: new Date('2026-05-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('system1HeadRepo', () => {
  const repo = createSystem1HeadRepo(getDb);

  beforeEach(() => {
    initDb(':memory:', SCHEMA_PATH);
  });

  afterEach(() => {
    closeDb();
  });

  it('returns null when no head exists', async () => {
    expect(await repo.getLatest('needsReply')).toBeNull();
  });

  it('assigns version 1 to the first head and returns the stored record', async () => {
    const saved = await repo.save(record());
    expect(saved.version).toBe(1);
    expect(saved.questionId).toBe('needsReply');
    expect(saved.armed).toBe(false);
  });

  it('increments the version per question', async () => {
    expect((await repo.save(record('needsReply'))).version).toBe(1);
    expect((await repo.save(record('needsReply'))).version).toBe(2);
    expect((await repo.save(record('importance'))).version).toBe(1);
    expect((await repo.save(record('needsReply'))).version).toBe(3);
    expect((await repo.save(record('importance'))).version).toBe(2);
  });

  it('getLatest returns the highest version for that question only', async () => {
    await repo.save(record('needsReply', { threshold: 0.7 }));
    await repo.save(record('needsReply', { threshold: 0.9 }));
    await repo.save(record('importance', { threshold: 0.5 }));

    const latest = await repo.getLatest('needsReply');
    expect(latest?.version).toBe(2);
    expect(latest?.threshold).toBe(0.9);
    expect((await repo.getLatest('importance'))?.threshold).toBe(0.5);
    expect(await repo.getLatest('folder')).toBeNull();
  });

  it('round-trips weights, metrics and dates through JSON', async () => {
    const input = record('needsReply', {
      armed: true,
      metrics: metrics({ auditCount: 7, auditAgreement: 0.857 }),
    });
    await repo.save(input);

    const got = await repo.getLatest('needsReply');
    expect(got).toEqual({ ...input, version: 1 });
    expect(got?.trainedAt).toBeInstanceOf(Date);
    expect(got?.trainedAt.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    expect(got?.weights.W[0]?.[2]).toBe(1e-7);
  });

  it('stores armed as a boolean', async () => {
    await repo.save(record('needsReply', { armed: true }));
    const row = getDb().prepare('SELECT armed FROM system1_heads').get() as { armed: number };
    expect(row.armed).toBe(1);
    expect((await repo.getLatest('needsReply'))?.armed).toBe(true);
  });

  it('setArmed toggles only the targeted version', async () => {
    await repo.save(record('needsReply'));
    await repo.save(record('needsReply'));

    await repo.setArmed('needsReply', 1, true);
    const rows = getDb()
      .prepare('SELECT version, armed FROM system1_heads ORDER BY version')
      .all() as Array<{ version: number; armed: number }>;
    expect(rows).toEqual([
      { version: 1, armed: 1 },
      { version: 2, armed: 0 },
    ]);

    await repo.setArmed('needsReply', 1, false);
    const row = getDb().prepare('SELECT armed FROM system1_heads WHERE version = 1').get() as {
      armed: number;
    };
    expect(row.armed).toBe(0);
  });

  it('setArmed does not touch other questions and ignores unknown versions', async () => {
    await repo.save(record('needsReply'));
    await repo.save(record('importance'));

    await repo.setArmed('needsReply', 1, true);
    await expect(repo.setArmed('needsReply', 99, true)).resolves.toBeUndefined();

    expect((await repo.getLatest('needsReply'))?.armed).toBe(true);
    expect((await repo.getLatest('importance'))?.armed).toBe(false);
  });

  it('updateMetrics replaces the metrics of one version', async () => {
    await repo.save(record('needsReply'));
    await repo.save(record('needsReply'));

    const updated = metrics({ auditCount: 12, auditAgreement: 0.91 });
    await repo.updateMetrics('needsReply', 1, updated);

    const rows = getDb()
      .prepare('SELECT version, metrics_json FROM system1_heads ORDER BY version')
      .all() as Array<{ version: number; metrics_json: string }>;
    expect(JSON.parse(rows[0]!.metrics_json)).toEqual(updated);
    expect(JSON.parse(rows[1]!.metrics_json)).toEqual(metrics());
  });

  it('updateMetrics is visible through getLatest', async () => {
    await repo.save(record('needsReply'));
    const updated = metrics({ auditCount: 3, auditAgreement: 1 });
    await repo.updateMetrics('needsReply', 1, updated);
    expect((await repo.getLatest('needsReply'))?.metrics).toEqual(updated);
  });

  it('keeps versions unique per question at the database level', () => {
    getDb()
      .prepare(
        `INSERT INTO system1_heads (question_id, version, embedding_model, weights_json, threshold, metrics_json, trained_at)
         VALUES ('q', 1, 'm', '{}', 0.5, '{}', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO system1_heads (question_id, version, embedding_model, weights_json, threshold, metrics_json, trained_at)
           VALUES ('q', 1, 'm', '{}', 0.5, '{}', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
