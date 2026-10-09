/**
 * Result of "Import model from folder" (System 1 encoder, installed offline).
 *
 * Lives in core so the main process and the renderer API share one type.
 */

export type ModelImportSummary = {
  /** Hugging Face id of the installed encoder. */
  model: string;
  /** Number of files copied. */
  files: number;
  bytes: number;
};

export type System1ModelImportResult =
  | { status: 'cancelled' }
  | ({ status: 'imported' } & ModelImportSummary);
