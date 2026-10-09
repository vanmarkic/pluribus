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
 *
 * Every vector is made from `system1Text(email, bodyPreview?)`, the same text
 * System 1 scores at inference time, so the RAG corpus and the System 1
 * training data are one and the same. A vector the System 1 decorator already
 * stored for an (email, model) is never overwritten here (`keepVector`).
 *
 * The encoder model is only ever downloaded on the user's request. Until it is
 * installed nothing here can be embedded: every path skips quietly (no error,
 * no log line per email) and classification carries on with the LLM.
 */

import * as crypto from 'crypto';
import type { Deps } from '../ports';
import type { Email } from '../domain';
import { isEmbeddingModelNotInstalled } from '../embedding-model';
import { system1Text } from '../system1/text';
import { isHumanCandidate, makeBodyPreview } from './body-preview';

type IndexDeps = Pick<Deps, 'emails' | 'vectorSearch' | 'embeddingRepo' | 'embeddingService'>;

/** Label stored for vectors whose folder is not known (never a made-up 'INBOX'). */
const UNKNOWN_FOLDER = '';

/**
 * Excerpt of an already-cached body, mirroring what the inference path embeds:
 * human mail only, local cache only. Never touches IMAP, and any failure just
 * means "no excerpt".
 */
async function cachedBodyPreview(
  deps: Pick<Deps, 'emails'>,
  email: Email,
): Promise<string | undefined> {
  if (!isHumanCandidate(email, null)) return undefined;
  try {
    const body = await deps.emails.getBody(email.id);
    if (!body) return undefined;
    const preview = makeBodyPreview(body);
    return preview === '' ? undefined : preview;
  } catch {
    return undefined;
  }
}

/**
 * The text to embed for an email, or null when there is too little to embed.
 * Near-empty mail (no subject, no excerpt) only produces a meaningless vector
 * and would pollute the corpus.
 */
async function textToIndex(deps: Pick<Deps, 'emails'>, email: Email): Promise<string | null> {
  const preview = await cachedBodyPreview(deps, email);
  if (`${email.subject ?? ''}${preview ?? ''}`.trim().length < 5) return null;
  return system1Text(email, preview);
}

/**
 * Index a single classified email into the semantic-search corpus. Idempotent:
 * the underlying embedding_repo.save() is an UPSERT on (email_id, model), so
 * re-indexing with a new folder on a user correction updates in place - and
 * keeps the vector System 1 stored, changing only the label.
 */
export const indexEmailForSearch =
  (deps: IndexDeps) =>
  async (emailId: number, folder: string, isCorrection: boolean = false): Promise<boolean> => {
    const email = await deps.emails.findById(emailId);
    if (!email) return false;

    const text = await textToIndex(deps, email);
    if (text === null) return false;

    try {
      await deps.vectorSearch.indexEmail(emailId, text, folder, isCorrection, { keepVector: true });
    } catch (error) {
      // No on-device model yet: nothing to index, and nothing worth reporting.
      if (isEmbeddingModelNotInstalled(error)) return false;
      throw error;
    }
    return true;
  };

/**
 * Batch variant called right after classifyNewEmails finishes. Runs serially
 * because the local encoder saturates a single CPU core; adding concurrency
 * here would just trash the cache without speeding anything up.
 */
export const indexClassifiedBatch =
  (deps: IndexDeps) =>
  async (
    items: Array<{ emailId: number; folder: string }>,
  ): Promise<{ indexed: number; failed: number }> => {
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

export type BackfillEmbeddingsResult = {
  /** Empty when nothing was started. */
  taskId: string;
  total: number;
  /**
   * `model-not-installed`: nothing was started because the on-device model has to
   * be installed (Settings > Download model) before anything can be embedded.
   */
  status: 'started' | 'model-not-installed';
};

/**
 * Start a background backfill pass. Counts un-indexed emails up front so the
 * progress bar is accurate, then indexes them one-by-one in the task runner.
 *
 * Folder source of truth: the classification state's suggestedFolder if any,
 * else unknown (''). A made-up 'INBOX' would teach the similarity search a
 * wrong label; unlabeled vectors still feed System 1 training and are simply
 * ignored when voting for a folder. Bodies come from the local cache only -
 * a backfill never opens an IMAP connection.
 */
export const backfillEmbeddings =
  (deps: BackfillDeps) =>
  async (
    options: { limit?: number; accountId?: number } = {},
  ): Promise<BackfillEmbeddingsResult> => {
    // Embedding needs the model, which is only downloaded on request: say so rather than
    // start a task that could only fail on every email.
    if (deps.embeddingService.getDownloadState?.().installed === false) {
      return { taskId: '', total: 0, status: 'model-not-installed' };
    }

    const limit = options.limit ?? 5000;
    const model = deps.embeddingService.getModel();

    // Page through emails in reverse-chronological order and collect the
    // un-indexed ones. List() supports accountId via standard options.
    const listed = await deps.emails.list(
      options.accountId !== undefined ? { limit, accountId: options.accountId } : { limit },
    );
    const toIndex: Array<{ email: Email; folder: string }> = [];
    for (const email of listed) {
      const existing = await deps.embeddingRepo.findByEmail(email.id, model);
      if (existing) continue;
      const state = await deps.classificationState.getState(email.id);
      toIndex.push({ email, folder: state?.suggestedFolder ?? UNKNOWN_FOLDER });
    }

    const taskId = crypto.randomUUID();
    deps.backgroundTasks.start(taskId, toIndex.length, async (onProgress) => {
      for (const item of toIndex) {
        try {
          const text = await textToIndex(deps, item.email);
          if (text !== null) {
            await deps.vectorSearch.indexEmail(item.email.id, text, item.folder, false, {
              keepVector: true,
            });
          }
        } catch (err) {
          // The model went away mid-run: no email can be embedded, so stop instead of warning
          // once per email.
          if (isEmbeddingModelNotInstalled(err)) return;
          // Keep going — one flaky embedding shouldn't nuke the whole backfill.
          console.warn(`Backfill: failed for email ${item.email.id}:`, err);
        }
        onProgress();
      }
    });

    return { taskId, total: toIndex.length, status: 'started' };
  };

/**
 * Simple stats for the "Semantic index" settings panel.
 */
export const getEmbeddingIndexStats =
  (deps: Pick<Deps, 'emails' | 'embeddingRepo' | 'embeddingService'>) =>
  async (): Promise<{ totalEmails: number; indexed: number; coverage: number; model: string }> => {
    const model = deps.embeddingService.getModel();
    const indexed = await deps.embeddingRepo.count(model);
    // emails.list() doesn't have a count method; use a generous limit.
    const sample = await deps.emails.list({ limit: 100000 });
    const totalEmails = sample.length;
    const coverage = totalEmails > 0 ? indexed / totalEmails : 0;
    return { totalEmails, indexed, coverage: Math.min(1, coverage), model };
  };
