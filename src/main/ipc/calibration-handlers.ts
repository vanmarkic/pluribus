/**
 * Confidence calibration IPC handlers (#96).
 *
 * One write endpoint (recalibrate) and two reads (latest, history).
 * Recalibration is cheap — ≤200 ms on 5k pairs — so it's safe to
 * trigger from the renderer settings panel.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Container } from '../container';
import { parseInput } from './schemas';

const RecalibrateInput = z
  .object({ minSamples: z.number().int().min(10).max(1000).optional() })
  .optional();

const HistoryLimit = z.union([
  z.undefined(),
  z.number().int().positive().max(200),
]);

export function setupCalibrationHandlers(container: Container): void {
  const { useCases, deps } = container;

  ipcMain.handle('calibration:recalibrate', async (_event, opts?: unknown) => {
    const parsed = parseInput(RecalibrateInput, opts, 'opts');
    return useCases.recalibrateConfidence(parsed ?? {});
  });

  ipcMain.handle('calibration:getLatest', async () => {
    return deps.calibration.loadLatest();
  });

  ipcMain.handle('calibration:getHistory', async (_event, limit?: unknown) => {
    const parsed = parseInput(HistoryLimit, limit, 'limit');
    return deps.calibration.listHistory(parsed ?? 30);
  });
}
