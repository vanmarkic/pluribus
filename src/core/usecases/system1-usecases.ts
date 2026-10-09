/**
 * System 1 use cases (Milestone 2)
 *
 * Status, (re)training and auditing of the local System 1 heads.
 */

import type { Deps } from '../ports';
import type { System1Status } from '../system1/types';

export const getSystem1Status =
  (_deps: Pick<Deps, 'system1Heads' | 'embeddingService'>) => async (): Promise<System1Status> => {
    // TODO(P4): read the latest head per question and summarise its metrics.
    return { embeddingModel: '', heads: [] };
  };

export const trainSystem1 =
  (_deps: Pick<Deps, 'system1Heads' | 'system1Training' | 'embeddingService'>) =>
  async (_opts: { questionIds?: string[]; now?: Date } = {}): Promise<System1Status> => {
    // TODO(P4): fit heads from deps.system1Training samples and persist them.
    return { embeddingModel: '', heads: [] };
  };

export const recordSystem1Audit =
  (_deps: Pick<Deps, 'system1Heads'>) =>
  async (_opts: { questionId: string; version: number; agreed: boolean }): Promise<void> => {
    // TODO(P4): fold the audit result into the head's rolling audit metrics.
  };
