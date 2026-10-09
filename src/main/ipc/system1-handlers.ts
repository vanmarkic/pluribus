/**
 * System 1 (local classifier) IPC handlers.
 *
 * Settings are not handled here: they go through `config:get/set('system1')`.
 */

import { dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { Container } from '../container';
import type { ModelImportSummary, System1ModelImportResult } from '../../core/model-import';
import type { System1Status } from '../../core/system1/types';
import type { RendererWindow, WindowGetter } from '../window-manager';
import { checkRateLimit } from './validation';

/** The part of Electron's `dialog.showOpenDialog` result that is used. */
export type OpenDialogResult = { canceled: boolean; filePaths: string[] };

export type System1HandlerOptions = {
  /** Late-bound main window, used as the parent of the folder picker. */
  getWindow?: WindowGetter;
  /**
   * Installs a model folder into the encoder's cache (`createSystem1Runtime().importModel`).
   * Without it the import channel reports "not available".
   */
  importModel?: (srcDir: string) => Promise<ModelImportSummary>;
  /**
   * Downloads the encoder model from huggingface.co (`createSystem1Runtime().downloadModel`).
   * Runs only when the user clicks "Download model". Without it the channel reports "not available".
   */
  downloadModel?: () => Promise<void>;
  /** Folder picker. Defaults to Electron's `dialog.showOpenDialog`. */
  showOpenDialog?: (
    parent: RendererWindow | null,
    options: { title: string; buttonLabel: string; properties: ['openDirectory'] },
  ) => Promise<OpenDialogResult>;
};

const defaultShowOpenDialog: NonNullable<System1HandlerOptions['showOpenDialog']> = (
  parent,
  options,
) =>
  parent
    ? dialog.showOpenDialog(parent as unknown as BrowserWindow, options)
    : dialog.showOpenDialog(options);

export function setupSystem1Handlers(
  container: Container,
  options: System1HandlerOptions = {},
): void {
  const { useCases } = container;
  const showOpenDialog = options.showOpenDialog ?? defaultShowOpenDialog;

  ipcMain.handle('system1:getStatus', async () => {
    return useCases.getSystem1Status();
  });

  ipcMain.handle('system1:retrain', async () => {
    checkRateLimit('system1:retrain', 5);
    return useCases.trainSystem1();
  });

  // The model is never fetched on its own: this is the only way the app contacts huggingface.co,
  // and it needs the user's click. The renderer supplies nothing (no URL, no path); it polls
  // `system1:getStatus` for progress while this call is pending.
  ipcMain.handle('system1:downloadModel', async (): Promise<System1Status> => {
    checkRateLimit('system1:downloadModel', 5);
    const downloadModel = options.downloadModel;
    if (!downloadModel) throw new Error('Model download is not available');

    await downloadModel();
    return useCases.getSystem1Status();
  });

  // The renderer never names a path: the folder is chosen in a native picker
  // and validated (and copied) by the encoder adapter before it is used.
  ipcMain.handle('system1:importModel', async (): Promise<System1ModelImportResult> => {
    checkRateLimit('system1:importModel', 20);
    const importModel = options.importModel;
    if (!importModel) throw new Error('Model import is not available');

    const window = options.getWindow?.() ?? null;
    const picked = await showOpenDialog(window && !window.isDestroyed() ? window : null, {
      title: 'Choose the folder that contains the encoder model',
      buttonLabel: 'Import model',
      properties: ['openDirectory'],
    });
    const folder = picked.filePaths[0];
    if (picked.canceled || folder === undefined) return { status: 'cancelled' };

    return { status: 'imported', ...(await importModel(folder)) };
  });
}
