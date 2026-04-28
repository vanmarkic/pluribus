/**
 * Calibration use cases (#96).
 *
 * recalibrate() collects pairs, fits a Platt model, measures ECE before
 * and after, and appends the result. Designed to be cheap enough to run
 * opportunistically (after N new feedback rows) or on a nightly
 * schedule; typical wall time is <200 ms for a 5k-pair dataset.
 *
 * applyCalibration() wraps the math helper so use-case code can call
 * deps.useCases.applyCalibration(raw) without reaching into the adapter.
 */

import type { Deps } from '../ports';
import {
  fitPlattScaling,
  calibrateConfidence,
  expectedCalibrationError,
  IDENTITY_CALIBRATION,
  type CalibrationModel,
} from '../../adapters/llm/calibration';

export const recalibrateConfidence =
  (deps: Pick<Deps, 'calibration'>) =>
  async (
    options: { minSamples?: number } = {},
  ): Promise<{
    fitSize: number;
    eceBefore: number;
    eceAfter: number;
    fitted: boolean;
  }> => {
    const pairs = await deps.calibration.collectFitPairs();
    const minSamples = options.minSamples ?? 50;

    if (pairs.length < minSamples) {
      return { fitSize: pairs.length, eceBefore: 0, eceAfter: 0, fitted: false };
    }

    const eceBefore = expectedCalibrationError(pairs);
    const model = fitPlattScaling(pairs, { minSamples });
    // fitPlattScaling returns IDENTITY_CALIBRATION on degenerate labels;
    // don't persist a no-op fit in that case.
    if (model.fitSize === 0) {
      return { fitSize: pairs.length, eceBefore, eceAfter: eceBefore, fitted: false };
    }

    const eceAfter = expectedCalibrationError(pairs, { model });
    await deps.calibration.saveFit({
      a: model.a,
      b: model.b,
      fitSize: model.fitSize,
      eceBefore,
      eceAfter,
    });
    return { fitSize: model.fitSize, eceBefore, eceAfter, fitted: true };
  };

/**
 * Fetch the latest fit and wrap it as a CalibrationModel the math helper
 * understands. Callers cache the result for the length of a classify
 * batch — it's stable between recalibration runs.
 */
export const loadActiveCalibration =
  (deps: Pick<Deps, 'calibration'>) =>
  async (): Promise<CalibrationModel> => {
    const record = await deps.calibration.loadLatest();
    if (!record) return IDENTITY_CALIBRATION;
    return { a: record.a, b: record.b, fitSize: record.fitSize };
  };

export { calibrateConfidence };
