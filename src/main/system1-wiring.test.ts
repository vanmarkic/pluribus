/**
 * System 1 runtime wiring: the nightly retrain job, offline model import and
 * the dependency bundle for the `withSystem1` decorator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSystem1Runtime, buildSystem1ClassifierDeps } from './system1-wiring';
import { DEFAULT_SYSTEM1_SETTINGS, type System1Settings } from '../core/domain';
import type { System1Status } from '../core/system1/types';

const mkLogger = () =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() }) as any;

const STATUS: System1Status = { embeddingModel: 'Xenova/multilingual-e5-small', heads: [] };

describe('createSystem1Runtime', () => {
  let work: string;

  beforeEach(() => {
    vi.useFakeTimers();
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'pluribus-s1-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(work, { recursive: true, force: true });
  });

  function make(
    overrides: {
      settings?: Partial<System1Settings>;
      env?: Record<string, string>;
      embeddingService?: { reset?: () => void };
    } = {},
  ) {
    const trainSystem1 = vi.fn(async () => STATUS);
    const settings: System1Settings = { ...DEFAULT_SYSTEM1_SETTINGS, ...overrides.settings };
    const logger = mkLogger();
    const runtime = createSystem1Runtime({
      useCases: { trainSystem1 },
      deps: { embeddingService: overrides.embeddingService ?? {} } as any,
      getSettings: () => settings,
      cacheDir: path.join(work, 'models'),
      logger,
      env: overrides.env ?? {},
    });
    return { runtime, trainSystem1, logger, settings };
  }

  it('retrains about 10 minutes after start, then every 24 hours', async () => {
    const { runtime, trainSystem1 } = make();
    runtime.start();

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(trainSystem1).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(trainSystem1).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(trainSystem1).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it('PLURIBUS_DISABLE_SYSTEM1_JOB=1 turns the job off', async () => {
    const { runtime, trainSystem1 } = make({ env: { PLURIBUS_DISABLE_SYSTEM1_JOB: '1' } });
    runtime.start();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(trainSystem1).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('does not train while settings.enabled is false', async () => {
    const { runtime, trainSystem1 } = make({ settings: { enabled: false } });
    runtime.start();
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    expect(trainSystem1).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('start() twice does not start two jobs; stop() ends it', async () => {
    const { runtime, trainSystem1 } = make();
    runtime.start();
    runtime.start();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(trainSystem1).toHaveBeenCalledTimes(1);

    runtime.stop();
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000);
    expect(trainSystem1).toHaveBeenCalledTimes(1);
  });

  describe('importModel', () => {
    function writeModel(root: string) {
      for (const rel of [
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
        'onnx/model_quantized.onnx',
      ]) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), 'data');
      }
    }

    it('installs the configured model into cacheDir and tells the encoder to re-check', async () => {
      const reset = vi.fn();
      const { runtime } = make({ embeddingService: { reset } });
      const src = path.join(work, 'download');
      writeModel(src);

      expect(runtime.isModelCached()).toBe(false);
      const summary = await runtime.importModel(src);

      expect(summary).toEqual({
        model: 'Xenova/multilingual-e5-small',
        files: 4,
        bytes: 16,
      });
      expect(runtime.isModelCached()).toBe(true);
      expect(
        fs.existsSync(
          path.join(work, 'models', 'Xenova', 'multilingual-e5-small', 'onnx/model_quantized.onnx'),
        ),
      ).toBe(true);
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('rejects a folder that is not a model and leaves the cache untouched', async () => {
      const reset = vi.fn();
      const { runtime } = make({ embeddingService: { reset } });
      const src = path.join(work, 'junk');
      fs.mkdirSync(src);
      fs.writeFileSync(path.join(src, 'readme.txt'), 'x');

      await expect(runtime.importModel(src)).rejects.toThrow(/Missing/);
      expect(fs.existsSync(path.join(work, 'models'))).toBe(false);
      expect(reset).not.toHaveBeenCalled();
    });

    it('imports the model named in the settings', async () => {
      const { runtime } = make({
        settings: { embeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
      });
      const src = path.join(work, 'download');
      writeModel(src);
      const summary = await runtime.importModel(src);
      expect(summary.model).toBe('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
      expect(runtime.isModelCached()).toBe(true);
    });
  });
});

describe('buildSystem1ClassifierDeps', () => {
  const MODEL = 'Xenova/multilingual-e5-small';

  function make() {
    const heads = { getLatest: vi.fn(), save: vi.fn(), setArmed: vi.fn(), updateMetrics: vi.fn() };
    const embeddingService = {
      embed: vi.fn(async () => [0.25, 0.5, 0.75]),
      similarity: vi.fn(),
      getModel: () => MODEL,
    };
    const embeddingRepo = { save: vi.fn(async () => ({})) };
    const accounts = {
      findById: vi.fn(async (id: number) => (id === 1 ? { id: 1, email: 'me@test.com' } : null)),
    };
    const recordAudit = vi.fn(async () => {});
    const priorRepliesToSender = vi.fn(async () => 4);
    const getSettings = () => DEFAULT_SYSTEM1_SETTINGS;
    const log = vi.fn();
    const deps = buildSystem1ClassifierDeps({
      heads: heads as any,
      embeddingService: embeddingService as any,
      embeddingRepo: embeddingRepo as any,
      accounts: accounts as any,
      priorRepliesToSender,
      recordAudit,
      getSettings,
      log,
    });
    return { deps, heads, embeddingService, embeddingRepo, accounts, recordAudit, getSettings };
  }

  it('passes the head repo, settings and audit recorder straight through', async () => {
    const { deps, heads, recordAudit, getSettings } = make();
    expect(deps.heads).toBe(heads);
    expect(deps.getSettings).toBe(getSettings);
    await deps.recordAudit({ questionId: 'folder', version: 2, agreed: true });
    expect(recordAudit).toHaveBeenCalledWith({ questionId: 'folder', version: 2, agreed: true });
  });

  it('embeds with the local encoder and returns a Float32Array', async () => {
    const { deps, embeddingService } = make();
    const vector = await deps.embed('From: <x.be>\nSubject: Devis');
    expect(embeddingService.embed).toHaveBeenCalledWith('From: <x.be>\nSubject: Devis');
    expect(vector).toBeInstanceOf(Float32Array);
    expect(Array.from(vector)).toEqual([0.25, 0.5, 0.75]);
  });

  it("stores the scoring vector under the current model, keeping any folder label ('' if new)", async () => {
    const { deps, embeddingRepo } = make();
    await deps.storeEmbedding!(42, new Float32Array([0.25, 0.5, 0.75]));
    expect(embeddingRepo.save).toHaveBeenCalledWith(42, [0.25, 0.5, 0.75], '', false, MODEL, {
      keepFolder: true,
    });
  });

  it("looks up the account's own address ('' when unknown)", async () => {
    const { deps } = make();
    expect(await deps.myAddressFor(1)).toBe('me@test.com');
    expect(await deps.myAddressFor(99)).toBe('');
  });

  it('counts prior replies through the injected helper', async () => {
    const { deps } = make();
    expect(await deps.priorRepliesToSender(1, 'marie@atelier.be')).toBe(4);
  });
});
