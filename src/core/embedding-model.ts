/**
 * The on-device encoder model: what "not installed" looks like to the rest of
 * the app.
 *
 * The model (about 118 MB) comes from huggingface.co, which sees the user's IP
 * address. It is therefore never fetched on its own: only the user's explicit
 * "Download model" click (or importing a model folder) installs it. Until
 * then every caller must carry on without System 1 and without the semantic
 * index, quietly, and let the LLM (System 2) classify.
 *
 * Lives in core so use cases can recognise the error without importing an
 * adapter.
 */

const NOT_INSTALLED_CODE = 'EMBEDDING_MODEL_NOT_INSTALLED';

/**
 * Thrown by the encoder's `embed()` when the model is not on disk and no
 * explicit download is running. Nothing was fetched and nothing touched the
 * network.
 */
export class EmbeddingModelNotInstalledError extends Error {
  readonly code = NOT_INSTALLED_CODE;
  readonly model: string;

  constructor(model: string) {
    super(`The on-device model ${model} is not installed. Download it in Settings first.`);
    this.name = 'EmbeddingModelNotInstalledError';
    this.model = model;
  }
}

/**
 * Is this the "model not installed" condition? Matches on the code as well as
 * the class, so it still works across module copies and wrappers.
 */
export function isEmbeddingModelNotInstalled(
  error: unknown,
): error is EmbeddingModelNotInstalledError {
  return (
    error instanceof EmbeddingModelNotInstalledError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === NOT_INSTALLED_CODE)
  );
}

/** One progress report of an explicit model download. */
export type ModelDownloadProgress = {
  /** File being fetched, relative to the model folder. */
  file: string;
  loaded: number;
  total: number;
};

export type ModelDownloadOptions = {
  onProgress?: (progress: ModelDownloadProgress) => void;
};

/** Where the encoder model stands. */
export type ModelDownloadState = {
  /** The model files are on disk (downloaded or imported). */
  installed: boolean;
  /** An explicit download is running right now. */
  downloading: boolean;
  /** Why the last download failed; null when none failed (or the model is installed since). */
  error: string | null;
};
