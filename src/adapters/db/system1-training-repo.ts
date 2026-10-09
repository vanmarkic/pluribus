/**
 * System 1 Training Repository
 *
 * Supplies labelled training samples (embedding + features + label) for the
 * System 1 heads.
 */

import Database from 'better-sqlite3';
import type { System1TrainingRepo } from '../../core/ports';

export function createSystem1TrainingRepo(_getDb: () => Database.Database): System1TrainingRepo {
  return {
    // TODO(P4): join email_embeddings, email_signals and user feedback into TrainingSample rows.
    async listSamples() {
      return [];
    },
  };
}
