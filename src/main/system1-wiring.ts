/**
 * System 1 runtime wiring (Electron main process).
 *
 * Two pieces the composition root (container / app start) plugs in:
 *
 * - `createSystem1Runtime`: the nightly retrain job, "import model from
 *   folder" and "download model". Everything it needs is passed in, so it is unit-testable.
 * - `buildSystem1ClassifierDeps`: the dependency bundle of the `withSystem1`
 *   triage decorator, assembled from container pieces. It does not need the
 *   finished `Deps`/`UseCases`, so the decorator can be built while the
 *   container is still being put together (pass
 *   `recordAudit: recordSystem1Audit({ system1Heads })`).
 *
 * Privacy: embedding, training and scoring all happen on this device. The
 * encoder model lives in `cacheDir` (userData/models). It is never fetched on
 * its own: `downloadModel` (huggingface.co, which sees the user's IP address)
 * only runs when the user clicks "Download model", and importing a folder
 * installs it with no network at all. Until it is installed System 1 is off and
 * the LLM decides.
 */

import type { Logger } from 'pino';
import type { System1Settings } from '../core/domain';
import type {
  AccountRepo,
  Deps,
  EmbeddingRepo,
  EmbeddingService,
  System1HeadRepo,
} from '../core/ports';
import type { UseCases } from '../core';
import type { ModelImportSummary } from '../core/model-import';
import { importModelFromFolder, isModelCached } from '../adapters/embeddings';
import { startSystem1Scheduler, type System1Scheduler } from './schedulers/system1-scheduler';

// ============================================
// Runtime: nightly retrain + offline model import
// ============================================

export type System1RuntimeOptions = {
  useCases: Pick<UseCases, 'trainSystem1'>;
  /** The running encoder; if it can `reset()`, it re-checks the cache after an import. */
  deps: { embeddingService: Deps['embeddingService'] & { reset?: () => void } };
  /** Read on every use, so settings changes apply without a restart. */
  getSettings: () => System1Settings;
  /** Where encoder models are cached (`userData/models`). */
  cacheDir: string;
  logger: Logger;
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  intervalMs?: number;
  initialDelayMs?: number;
};

export type System1Runtime = {
  /** Start the nightly retrain job (first run ~10 min after start, then every 24 h). */
  start: () => void;
  stop: () => void;
  /**
   * Install the configured encoder from a folder the user downloaded elsewhere.
   * Throws a user-readable error when the folder is not a complete model.
   * Hand this to `setupSystem1Handlers(container, { importModel })`.
   */
  importModel: (srcDir: string) => Promise<ModelImportSummary>;
  /**
   * Download the configured encoder from huggingface.co. The only code that makes
   * System 1 touch the network, and it runs only for the user's "Download model"
   * click (hand this to `setupSystem1Handlers(container, { downloadModel })`).
   * Concurrent calls share one download; a failure rejects with a readable message
   * and a later call starts over.
   */
  downloadModel: () => Promise<void>;
  /** Is the configured encoder already on disk (so it will run fully offline)? */
  isModelCached: () => boolean;
};

export function createSystem1Runtime(opts: System1RuntimeOptions): System1Runtime {
  const { useCases, deps, getSettings, cacheDir, logger } = opts;
  const env = opts.env ?? process.env;

  let scheduler: System1Scheduler | null = null;

  return {
    start() {
      if (scheduler) return;
      if (env.PLURIBUS_DISABLE_SYSTEM1_JOB === '1') {
        logger.info({ component: 'system1-wiring' }, 'system1.job.disabled-by-env');
        return;
      }
      scheduler = startSystem1Scheduler({
        logger,
        runOnce: () => useCases.trainSystem1(),
        isEnabled: () => getSettings().enabled,
        ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
        ...(opts.initialDelayMs !== undefined ? { initialDelayMs: opts.initialDelayMs } : {}),
      });
    },

    stop() {
      scheduler?.stop();
      scheduler = null;
    },

    async importModel(srcDir) {
      const model = getSettings().embeddingModel;
      const result = await importModelFromFolder(srcDir, cacheDir, model);
      // Next embed() sees the model on disk and loads it without network access.
      deps.embeddingService.reset?.();
      logger.info(
        { component: 'system1-wiring', model, files: result.files.length },
        'system1.model.imported',
      );
      return { model, files: result.files.length, bytes: result.bytes };
    },

    async downloadModel() {
      const model = getSettings().embeddingModel;
      const service = deps.embeddingService;
      if (!service.downloadModel) throw new Error('Model download is not available');

      logger.info({ component: 'system1-wiring', model }, 'system1.model.download.start');
      try {
        await service.downloadModel();
      } catch (error) {
        logger.warn(
          {
            component: 'system1-wiring',
            model,
            error: error instanceof Error ? error.message : String(error),
          },
          'system1.model.download.failed',
        );
        throw error;
      }
      logger.info({ component: 'system1-wiring', model }, 'system1.model.download.done');
    },

    isModelCached() {
      return isModelCached(cacheDir, getSettings().embeddingModel);
    },
  };
}

// ============================================
// Dependencies of the withSystem1 decorator
// ============================================

/**
 * What `withSystem1(inner, deps)` (adapters/triage/system1-classifier.ts)
 * takes. Mirrors its documented signature; passing the result to
 * `withSystem1` is the compile-time check that the two stay in sync.
 */
export type System1ClassifierDeps = {
  heads: System1HeadRepo;
  embed: (text: string) => Promise<Float32Array>;
  myAddressFor: (accountId: number) => Promise<string>;
  priorRepliesToSender: (accountId: number, address: string, before?: Date) => Promise<number>;
  getSettings: () => System1Settings;
  recordAudit: (o: { questionId: string; version: number; agreed: boolean }) => Promise<void>;
  storeEmbedding?: (emailId: number, vector: Float32Array) => Promise<void>;
  rng?: () => number;
  log?: (msg: string, meta?: object) => void;
};

export type BuildSystem1ClassifierDepsOptions = {
  heads: System1HeadRepo;
  /** The on-device encoder (`createEmbeddingService`). */
  embeddingService: EmbeddingService;
  embeddingRepo: Pick<EmbeddingRepo, 'save'>;
  accounts: Pick<AccountRepo, 'findById'>;
  /**
   * Mail I sent to an address (`createPriorRepliesCounter(getDb)` from
   * adapters/embeddings/sender-history). Must match the training side's definition.
   */
  priorRepliesToSender: (accountId: number, address: string, before?: Date) => Promise<number>;
  /** e.g. `recordSystem1Audit({ system1Heads })`. */
  recordAudit: System1ClassifierDeps['recordAudit'];
  getSettings: () => System1Settings;
  rng?: () => number;
  log?: (msg: string, meta?: object) => void;
};

export function buildSystem1ClassifierDeps(
  opts: BuildSystem1ClassifierDepsOptions,
): System1ClassifierDeps {
  const { embeddingService, embeddingRepo, accounts } = opts;

  return {
    heads: opts.heads,
    getSettings: opts.getSettings,
    recordAudit: opts.recordAudit,
    priorRepliesToSender: opts.priorRepliesToSender,

    embed: async (text) => Float32Array.from(await embeddingService.embed(text)),

    myAddressFor: async (accountId) => (await accounts.findById(accountId))?.email ?? '',

    // The vector the heads scored becomes the training vector for this email:
    // the label (if any) is left alone, and the RAG indexer never overwrites it.
    storeEmbedding: async (emailId, vector) => {
      await embeddingRepo.save(
        emailId,
        Array.from(vector),
        '',
        false,
        embeddingService.getModel(),
        {
          keepFolder: true,
        },
      );
    },

    ...(opts.rng ? { rng: opts.rng } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  };
}
