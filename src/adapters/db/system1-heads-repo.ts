/**
 * System 1 Heads Repository
 *
 * Persists trained System 1 heads (weights + metrics as JSON). Every save is a
 * new immutable version per question; arming and metric updates mutate the
 * row for an existing version only.
 */

import Database from 'better-sqlite3';
import type { System1HeadRepo } from '../../core/ports';
import type { HeadMetrics, HeadRecord, HeadWeights } from '../../core/system1/types';

function mapHead(row: any): HeadRecord {
  return {
    questionId: row.question_id,
    version: row.version,
    embeddingModel: row.embedding_model,
    weights: JSON.parse(row.weights_json) as HeadWeights,
    threshold: Number(row.threshold),
    armed: Boolean(row.armed),
    metrics: JSON.parse(row.metrics_json) as HeadMetrics,
    trainedAt: new Date(row.trained_at),
  };
}

export function createSystem1HeadRepo(getDb: () => Database.Database): System1HeadRepo {
  return {
    async save(record) {
      const db = getDb();
      const insert = db.transaction((): number => {
        const next = db
          .prepare(
            'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM system1_heads WHERE question_id = ?',
          )
          .get(record.questionId) as { next: number };
        db.prepare(
          `
          INSERT INTO system1_heads (
            question_id, version, embedding_model, weights_json,
            threshold, armed, metrics_json, trained_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          record.questionId,
          next.next,
          record.embeddingModel,
          JSON.stringify(record.weights),
          record.threshold,
          record.armed ? 1 : 0,
          JSON.stringify(record.metrics),
          record.trainedAt.toISOString(),
        );
        return next.next;
      });
      const version = insert();
      return { ...record, version };
    },

    async getLatest(questionId) {
      const row = getDb()
        .prepare('SELECT * FROM system1_heads WHERE question_id = ? ORDER BY version DESC LIMIT 1')
        .get(questionId);
      return row ? mapHead(row) : null;
    },

    async setArmed(questionId, version, armed) {
      getDb()
        .prepare('UPDATE system1_heads SET armed = ? WHERE question_id = ? AND version = ?')
        .run(armed ? 1 : 0, questionId, version);
    },

    async updateMetrics(questionId, version, metrics) {
      getDb()
        .prepare('UPDATE system1_heads SET metrics_json = ? WHERE question_id = ? AND version = ?')
        .run(JSON.stringify(metrics), questionId, version);
    },
  };
}
