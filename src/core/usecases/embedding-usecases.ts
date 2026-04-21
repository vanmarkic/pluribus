/**
 * Embedding / semantic-search use cases (#88).
 *
 * Auto-indexing every classified email turns the embedding table into a real
 * RAG corpus, so the enhanced triage classifier and the Anthropic agent tools
 * have progressively more data to retrieve against.
 *
 * The `backfillEmbeddings` use case covers existing inboxes so users don't
 * have to wait for new emails to arrive before semantic retrieval becomes
 * useful.
 */

import * as crypto from 'crypto';
import type { Deps } from '../ports';

type IndexDeps = Pick<Deps, 'emails' | 'vectorSearch' | 'embeddingRepo' | 'embeddingService'>;

/** Build the text we embed. Mirrors prepareEmailForEmbedding in the adapter. */
function emailTextFor(email: { subject: string; snippet?: string | null }): string {
  return `${email.subject}\n${email.snippet ?? ''}`.trim();
}

/**
 * Index a single classified email into the semantic-search corpus. Idempotent:
 * the underlying embedding_repo.save() is an UPSERT on (email_id, model), so
 * re-indexing with a new folder on a user correction updates in place.
 */
export const indexEmailForSearch = (deps: IndexDeps) =>
  async (emailId: number, folder: string, isCorrection: boolean = false): Promise<boolean> => {
    const email = await deps.emails.findById(emailId);
    if (!email) return false;

    const text = emailTextFor(email);
    // Don't pollute the corpus with near-empty texts (subject-only with no
    // snippet tends to produce meaningless embeddings).
    if (text.length < 5) return false;

    await deps.vectorSearch.indexEmail(emailId, text, folder, isCorrection);
    return true;
  };

/**
 * Batch variant called right after classifyNewEmails finishes. Runs serially
 * because the local all-MiniLM-L6-v2 model saturates a single CPU core; adding
 * concurrency here would just trash the cache without speeding anything up.
 */
export const indexClassifiedBatch = (deps: IndexDeps) =>
  async (items: Array<{ emailId: number; folder: string }>): Promise<{ indexed: number; failed: number }> => {
    let indexed = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const ok = await indexEmailForSearch(deps)(item.emailId, item.folder, false);
        if (ok) indexed++;
      } catch {
        failed++;
      }
    }
    return { indexed, failed };
  };

type BackfillDeps = IndexDeps & Pick<Deps, 'classificationState' | 'backgroundTasks'>;

/**
 * Start a background backfill pass. Counts un-indexed emails up front so the
 * progress bar is accurate, then indexes them one-by-one in the task runner.
 *
 * Folder source of truth: the classification state's suggestedFolder if any,
 * else 'INBOX' (the corpus is still useful for "find similar" even if the
 * folder assignment is nominal).
 */
export const backfillEmbeddings = (deps: BackfillDeps) =>
  async (options: { limit?: number; accountId?: number } = {}): Promise<{ taskId: string; total: number }> => {
    const limit = options.limit ?? 5000;
    const model = deps.embeddingService.getModel();

    // Page through emails in reverse-chronological order and collect the
    // un-indexed ones. List() supports accountId via standard options.
    const listed = await deps.emails.list({ limit, accountId: options.accountId });
    const toIndex: Array<{ emailId: number; folder: string; subject: string; snippet: string | null | undefined }> = [];
    for (const email of listed) {
      const existing = await deps.embeddingRepo.findByEmail(email.id, model);
      if (existing) continue;
      const state = await deps.classificationState.getState(email.id);
      const folder = state?.suggestedFolder ?? 'INBOX';
      toIndex.push({ emailId: email.id, folder, subject: email.subject, snippet: email.snippet });
    }

    const taskId = crypto.randomUUID();
    deps.backgroundTasks.start(taskId, toIndex.length, async (onProgress) => {
      for (const item of toIndex) {
        try {
          const text = emailTextFor(item);
          if (text.length >= 5) {
            await deps.vectorSearch.indexEmail(item.emailId, text, item.folder, false);
          }
        } catch (err) {
          // Keep going — one flaky embedding shouldn't nuke the whole backfill.
          console.warn(`Backfill: failed for email ${item.emailId}:`, err);
        }
        onProgress();
      }
    });

    return { taskId, total: toIndex.length };
  };

/**
 * Simple stats for the "Semantic index" settings panel.
 */
export const getEmbeddingIndexStats = (deps: Pick<Deps, 'emails' | 'embeddingRepo' | 'embeddingService'>) =>
  async (): Promise<{ totalEmails: number; indexed: number; coverage: number; model: string }> => {
    const model = deps.embeddingService.getModel();
    const indexed = await deps.embeddingRepo.count(model);
    // emails.list() doesn't have a count method; use a generous limit.
    const sample = await deps.emails.list({ limit: 100000 });
    const totalEmails = sample.length;
    const coverage = totalEmails > 0 ? indexed / totalEmails : 0;
    return { totalEmails, indexed, coverage: Math.min(1, coverage), model };
  };
