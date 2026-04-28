/**
 * Calibration repository (#96).
 *
 * Persists Platt-scaling fits and sources the (raw_confidence, correct)
 * pairs that the recalibration use case consumes. The SQL for the pairs
 * is the non-obvious part: classification_state holds the raw confidence
 * at classification time, classification_feedback holds the user's
 * action at review time, and we join them on email_id.
 */

import Database from 'better-sqlite3';
import type { CalibrationRepo, CalibrationRecord } from '../../core/ports';

function mapRecord(row: any): CalibrationRecord {
  return {
    id: row.id,
    fitAt: new Date(row.fit_at),
    a: Number(row.a),
    b: Number(row.b),
    fitSize: Number(row.fit_size),
    eceBefore: row.ece_before === null ? null : Number(row.ece_before),
    eceAfter: row.ece_after === null ? null : Number(row.ece_after),
  };
}

export function createCalibrationRepo(getDb: () => Database.Database): CalibrationRepo {
  return {
    async saveFit(input) {
      getDb().prepare(`
        INSERT INTO calibration_models (a, b, fit_size, ece_before, ece_after)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.a, input.b, input.fitSize, input.eceBefore, input.eceAfter);
    },

    async loadLatest() {
      const row = getDb().prepare(`
        SELECT * FROM calibration_models ORDER BY fit_at DESC LIMIT 1
      `).get() as any;
      return row ? mapRecord(row) : null;
    },

    async listHistory(limit = 30) {
      const rows = getDb().prepare(`
        SELECT * FROM calibration_models ORDER BY fit_at DESC LIMIT ?
      `).all(Math.min(Math.max(1, limit), 200)) as any[];
      return rows.map(mapRecord);
    },

    async collectFitPairs() {
      // accuracy_score encoding:
      //   1.00 = accept (user agreed with AI folder)
      //   0.98 = accept_edit (user accepted, but changed folder — still a
      //          success for confidence calibration since they accepted
      //          the classification action at all)
      //   0.00 = dismiss (user rejected)
      //
      // We treat accuracy_score >= 0.5 as "correct" for calibration
      // purposes. One feedback row per email — if the user has taken
      // several actions, only the most recent counts.
      const rows = getDb().prepare(`
        SELECT
          cs.confidence            AS raw_confidence,
          latest.accuracy_score    AS accuracy_score
        FROM classification_state cs
        INNER JOIN (
          SELECT email_id, accuracy_score, MAX(created_at) AS ts
          FROM classification_feedback
          GROUP BY email_id
        ) latest ON latest.email_id = cs.email_id
        WHERE cs.confidence IS NOT NULL
      `).all() as Array<{ raw_confidence: number; accuracy_score: number }>;

      return rows
        .filter(r => r.raw_confidence !== null && r.accuracy_score !== null)
        .map(r => ({
          rawConfidence: Number(r.raw_confidence),
          correct: Number(r.accuracy_score) >= 0.5 ? 1 : 0,
        }));
    },
  };
}
