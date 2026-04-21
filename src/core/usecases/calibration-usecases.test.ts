import { describe, it, expect, vi } from 'vitest';
import { recalibrateConfidence, loadActiveCalibration } from './calibration-usecases';

function mkDeps(pairs: Array<{ rawConfidence: number; correct: number }>) {
  const saved: any[] = [];
  const calibration = {
    collectFitPairs: async () => pairs,
    saveFit: vi.fn(async (input: any) => { saved.push(input); }),
    loadLatest: async () => null,
    listHistory: async () => [],
  };
  return { deps: { calibration } as any, saved, calibration };
}

describe('recalibrateConfidence', () => {
  it('refuses to fit when the pair count is below minSamples', async () => {
    const { deps, calibration } = mkDeps(Array.from({ length: 20 }, () => ({
      rawConfidence: 0.8,
      correct: 1,
    })));
    const result = await recalibrateConfidence(deps)({ minSamples: 50 });
    expect(result.fitted).toBe(false);
    expect(result.fitSize).toBe(20);
    expect(calibration.saveFit).not.toHaveBeenCalled();
  });

  it('refuses to persist a degenerate single-label fit', async () => {
    const { deps, calibration } = mkDeps(Array.from({ length: 100 }, () => ({
      rawConfidence: 0.5,
      correct: 1,
    })));
    const result = await recalibrateConfidence(deps)();
    expect(result.fitted).toBe(false);
    expect(calibration.saveFit).not.toHaveBeenCalled();
  });

  it('fits and persists on a healthy mixed-label dataset', async () => {
    const pairs = [
      ...Array.from({ length: 60 }, (_, i) => ({ rawConfidence: 0.9, correct: i % 3 === 0 ? 0 : 1 })),
      ...Array.from({ length: 60 }, (_, i) => ({ rawConfidence: 0.2, correct: i % 3 === 0 ? 1 : 0 })),
    ];
    const { deps, calibration } = mkDeps(pairs);
    const result = await recalibrateConfidence(deps)();
    expect(result.fitted).toBe(true);
    expect(result.fitSize).toBe(120);
    expect(calibration.saveFit).toHaveBeenCalledTimes(1);
    const arg = calibration.saveFit.mock.calls[0][0];
    expect(arg.fitSize).toBe(120);
    expect(typeof arg.a).toBe('number');
    expect(typeof arg.b).toBe('number');
  });
});

describe('loadActiveCalibration', () => {
  it('returns IDENTITY_CALIBRATION when no record exists', async () => {
    const deps = { calibration: { loadLatest: async () => null } } as any;
    const model = await loadActiveCalibration(deps)();
    expect(model.fitSize).toBe(0);
  });

  it('returns the persisted model', async () => {
    const deps = {
      calibration: {
        loadLatest: async () => ({
          id: 1, fitAt: new Date(), a: 3, b: -1, fitSize: 250, eceBefore: 0.2, eceAfter: 0.05,
        }),
      },
    } as any;
    const model = await loadActiveCalibration(deps)();
    expect(model).toEqual({ a: 3, b: -1, fitSize: 250 });
  });
});
