/**
 * Embedding Service
 *
 * On-device sentence encoder via @xenova/transformers (ONNX). Nothing here
 * talks to a cloud API: the model runs on the user's machine.
 *
 * Privacy rule: models live in a caller-provided cache directory. Once the
 * configured model is present there, `env.allowRemoteModels` is switched off,
 * so the library cannot reach the network at all. Only a missing model may be
 * downloaded, once. "Import model from folder" installs it fully offline.
 *
 * Default model: Xenova/multilingual-e5-small (384d). Most of the user's mail
 * is French, and e5 scores clearly higher than paraphrase-multilingual-MiniLM
 * on French benchmarks. e5 models need the input prefix "query: "; it is added
 * in exactly one place (`prepareModelInput`, used by `embed`) so training and
 * inference vectors always match.
 */

import * as fs from 'fs';
import * as path from 'path';
import { env, pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import type { EmbeddingService } from '../../core/ports';
import { DEFAULT_SYSTEM1_SETTINGS } from '../../core/domain';

export const DEFAULT_EMBEDDING_MODEL: string = DEFAULT_SYSTEM1_SETTINGS.embeddingModel;

/**
 * Pinned Hugging Face commit per model. Unpinned models use 'main'.
 * TODO: pin the commit shas (needs a network that can reach huggingface.co,
 * e.g. `curl https://huggingface.co/api/models/<id>` -> `sha`).
 */
export const PINNED_MODEL_REVISIONS: Readonly<Record<string, string>> = {};

/** After a failed model load, wait this long before touching the network again. */
const LOAD_RETRY_COOLDOWN_MS = 60_000;

/** Models whose DB key predates the multilingual encoder (keeps existing vectors valid). */
const LEGACY_MODEL_KEYS: Readonly<Record<string, string>> = {
  'Xenova/all-MiniLM-L6-v2': 'all-MiniLM-L6-v2',
};

// ============================================
// Model naming
// ============================================

function assertSafeModelName(modelName: string): void {
  const safe =
    typeof modelName === 'string' &&
    modelName.length > 0 &&
    !modelName.includes('\\') &&
    !path.isAbsolute(modelName) &&
    modelName.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
  if (!safe) throw new Error(`Invalid model name: ${JSON.stringify(modelName)}`);
}

/** The key embeddings are stored under (`email_embeddings.embedding_model`). */
export function embeddingModelKey(modelName: string): string {
  return LEGACY_MODEL_KEYS[modelName] ?? modelName;
}

const E5_MODEL = /(^|[-_/])e5([-_]|$)/i;

/** e5 models were trained with a "query: " prefix on every input. */
export function prepareModelInput(modelName: string, text: string): string {
  return E5_MODEL.test(modelName) ? `query: ${text}` : text;
}

// ============================================
// Model files (cache layout shared with transformers.js)
// ============================================

/**
 * Files transformers.js needs to run the model offline, relative to the
 * model folder. The ONNX file depends on whether the quantized model is used.
 */
export function requiredModelFiles(quantized = true): string[] {
  return [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    quantized ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx',
  ];
}

/** Copied along when present; not needed by every tokenizer. */
const OPTIONAL_MODEL_FILES = [
  'special_tokens_map.json',
  'sentencepiece.bpe.model',
  'added_tokens.json',
  'vocab.txt',
  'merges.txt',
];

function modelFolder(cacheDir: string, modelName: string): string {
  return path.join(cacheDir, ...modelName.split('/'));
}

function hasContent(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function hasAll(root: string, files: string[]): boolean {
  return files.every((rel) => hasContent(path.join(root, rel)));
}

/**
 * Is the model already on disk? transformers.js stores a downloaded model at
 * `<cacheDir>/<model>/...` for the 'main' revision and at
 * `<cacheDir>/<model>/<revision>/...` for a pinned one; an imported model uses
 * the first layout and is found through `env.localModelPath`.
 */
export function isModelCached(
  cacheDir: string,
  modelName: string,
  opts: { revision?: string; quantized?: boolean } = {},
): boolean {
  assertSafeModelName(modelName);
  const files = requiredModelFiles(opts.quantized ?? true);
  const root = modelFolder(cacheDir, modelName);
  if (hasAll(root, files)) return true;
  const revision = opts.revision;
  return revision !== undefined && revision !== 'main' && hasAll(path.join(root, revision), files);
}

export type ModelImportResult = {
  /** Where the model now lives. */
  dir: string;
  /** Copied files, relative to the model folder. */
  files: string[];
  bytes: number;
};

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Install a model for offline use by copying it from a folder the user
 * downloaded elsewhere. The folder is either the model folder itself
 * (config.json, tokenizer.json, onnx/...) or a cache root that contains
 * `<org>/<name>`. Only known model files are copied; each is written to a
 * temporary name first so an interrupted copy never looks like a complete
 * model.
 */
export async function importModelFromFolder(
  src: string,
  cacheDir: string,
  modelName: string,
  opts: { quantized?: boolean } = {},
): Promise<ModelImportResult> {
  assertSafeModelName(modelName);
  if (!(await isDirectory(src))) {
    throw new Error(`Model folder not found: ${src} is not a folder`);
  }
  const required = requiredModelFiles(opts.quantized ?? true);

  const candidates = [src, modelFolder(src, modelName), path.join(src, path.basename(modelName))];
  const root = candidates.find((dir) => hasAll(dir, required));
  if (root === undefined) {
    const missing = required.filter((rel) => !hasContent(path.join(src, rel)));
    throw new Error(
      `This folder is not a ${modelName} model. Missing: ${missing.join(', ')}. ` +
        'Choose the folder that contains config.json, tokenizer.json and onnx/.',
    );
  }

  const files = [...required, ...OPTIONAL_MODEL_FILES.filter((rel) => hasContent(path.join(root, rel)))];
  const dest = modelFolder(cacheDir, modelName);
  const staged: Array<{ tmp: string; final: string }> = [];
  let bytes = 0;

  try {
    for (const rel of files) {
      const final = path.join(dest, rel);
      const tmp = `${final}.part`;
      await fs.promises.mkdir(path.dirname(final), { recursive: true });
      await fs.promises.copyFile(path.join(root, rel), tmp);
      staged.push({ tmp, final });
      bytes += (await fs.promises.stat(tmp)).size;
    }
    for (const { tmp, final } of staged) {
      await fs.promises.rename(tmp, final);
    }
  } catch (err) {
    await Promise.all(staged.map(({ tmp }) => fs.promises.rm(tmp, { force: true })));
    // A failing copy can leave its own partial temp file too.
    await Promise.all(files.map((rel) => fs.promises.rm(`${path.join(dest, rel)}.part`, { force: true })));
    throw err;
  }

  return { dir: dest, files, bytes };
}

// ============================================
// Service
// ============================================

export type EmbeddingServiceOptions = {
  /** Hugging Face model id; default Xenova/multilingual-e5-small. */
  modelName?: string;
  /** Where models are cached (userData/models). Default: transformers.js' own cache. */
  cacheDir?: string;
  /** Hugging Face revision (commit sha) to download. Default: pinned sha, else 'main'. */
  revision?: string;
  /** Use the int8 model (default true). */
  quantized?: boolean;
  /** Injectable clock (tests). */
  now?: () => number;
};

export type LocalEmbeddingService = EmbeddingService & {
  /** The configured Hugging Face model id. */
  getModelName: () => string;
  /** Are the model files already on disk (so no download can happen)? */
  isModelCached: () => boolean;
  /** Drop the loaded pipeline so the next embed() re-checks the cache (e.g. after an import). */
  reset: () => void;
};

/**
 * Create the on-device embedding service.
 *
 * Nothing is read or loaded until the first `embed()`: constructing the
 * service is free, and the cache check happens right before the model loads.
 */
export function createEmbeddingService(opts: EmbeddingServiceOptions = {}): LocalEmbeddingService {
  const modelName = opts.modelName ?? DEFAULT_EMBEDDING_MODEL;
  assertSafeModelName(modelName);
  const revision = opts.revision ?? PINNED_MODEL_REVISIONS[modelName] ?? 'main';
  const quantized = opts.quantized ?? true;
  const now = opts.now ?? Date.now;

  let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
  let lastFailure: { at: number; error: Error } | null = null;

  const effectiveCacheDir = (): string => opts.cacheDir ?? env.cacheDir;
  const cached = (): boolean =>
    isModelCached(effectiveCacheDir(), modelName, { revision, quantized });

  /** Decide, right before loading, whether the library may use the network. */
  function configureEnv(): void {
    const dir = effectiveCacheDir();
    env.cacheDir = dir;
    // Imported models live at <cacheDir>/<model>; make them visible as local models.
    env.localModelPath = dir;
    env.allowLocalModels = true;
    env.allowRemoteModels = !cached();
  }

  function load(): Promise<FeatureExtractionPipeline> {
    if (pipelinePromise) return pipelinePromise;
    if (lastFailure && now() - lastFailure.at < LOAD_RETRY_COOLDOWN_MS) {
      return Promise.reject(lastFailure.error);
    }
    configureEnv();
    const loading = pipeline('feature-extraction', modelName, { quantized, revision });
    pipelinePromise = loading;
    loading.then(
      () => {
        lastFailure = null;
      },
      (err: unknown) => {
        pipelinePromise = null;
        lastFailure = { at: now(), error: err instanceof Error ? err : new Error(String(err)) };
      },
    );
    return loading;
  }

  return {
    async embed(text: string): Promise<number[]> {
      const extractor = await load();

      // Mean pooling + L2 normalisation (cosine similarity is a dot product).
      const output = await extractor(prepareModelInput(modelName, text), {
        pooling: 'mean',
        normalize: true,
      });

      return Array.from(output.data as Float32Array);
    },

    similarity(a: number[], b: number[]): number {
      // Cosine similarity (dot product of normalized vectors)
      if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
      }

      let dotProduct = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i]! * b[i]!;
      }

      // Vectors should already be normalized, but clamp to [-1, 1] for safety
      return Math.max(-1, Math.min(1, dotProduct));
    },

    getModel(): string {
      return embeddingModelKey(modelName);
    },

    getModelName(): string {
      return modelName;
    },

    isModelCached: cached,

    reset(): void {
      pipelinePromise = null;
      lastFailure = null;
    },
  };
}

/**
 * Serialize embedding vector to binary format for SQLite storage.
 * Uses Float32Array for efficient storage (4 bytes per dimension).
 */
export function serializeEmbedding(vector: number[]): Buffer {
  const float32 = new Float32Array(vector);
  return Buffer.from(float32.buffer);
}

/**
 * Deserialize embedding vector from binary format.
 */
export function deserializeEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  return Array.from(float32);
}

/**
 * Prepare email text for embedding.
 * Combines subject and snippet with emphasis on subject.
 */
export function prepareEmailText(subject: string, snippet: string): string {
  // Truncate to reasonable length (model has 512 token limit)
  const maxLength = 400;
  const combined = `${subject}\n${snippet}`.trim();
  return combined.length > maxLength ? combined.substring(0, maxLength) : combined;
}
