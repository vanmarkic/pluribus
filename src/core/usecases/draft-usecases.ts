/**
 * Draft Use Cases
 *
 * All use cases related to email drafts:
 * - Saving, listing, getting drafts
 * - Deleting drafts
 */

import type { Deps } from '../ports';
import type { Draft, DraftInput, ListDraftsOptions } from '../domain';

// ============================================
// Draft Use Cases
// ============================================

export const saveDraft = (deps: Pick<Deps, 'drafts'>) =>
  async (input: DraftInput): Promise<Draft> => {
    // If id provided, check if draft exists to update
    if (input.id) {
      const existing = await deps.drafts.findById(input.id);
      if (existing) {
        return deps.drafts.update(input.id, input);
      }
    }
    // Otherwise save as new
    return deps.drafts.save(input);
  };

export const getDraft = (deps: Pick<Deps, 'drafts'>) =>
  (id: number): Promise<Draft | null> =>
    deps.drafts.findById(id);

export const listDrafts = (deps: Pick<Deps, 'drafts'>) =>
  (options: ListDraftsOptions = {}): Promise<Draft[]> =>
    deps.drafts.list(options);

export const deleteDraft = (deps: Pick<Deps, 'drafts'>) =>
  (id: number): Promise<void> =>
    deps.drafts.delete(id);
