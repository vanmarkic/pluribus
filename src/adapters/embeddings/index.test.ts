/**
 * Embedding Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { transformersEnv, pipelineMock, extractorMock } = vi.hoisted(() => {
  const extractor = vi.fn(async (_text: string, _opts: unknown) => ({
    data: new Float32Array([0.6, 0.8, 0]),
  }));
  return {
    transformersEnv: {
      cacheDir: '/default/cache',
      localModelPath: '/models/',
      allowRemoteModels: true,
      allowLocalModels: false,
    },
    pipelineMock: vi.fn(async (_task: string, _model: string, _opts: unknown) => extractor),
    extractorMock: extractor,
  };
});

vi.mock('@xenova/transformers', () => ({ env: transformersEnv, pipeline: pipelineMock }));

import {
  createEmbeddingService,
  serializeEmbedding,
  deserializeEmbedding,
  prepareEmailText,
  prepareModelInput,
  embeddingModelKey,
  isModelCached,
  importModelFromFolder,
  requiredModelFiles,
} from './index';

describe('EmbeddingService', () => {
  it.skip('should generate embeddings of correct dimension', async () => {
    // Skipped: requires network access to download model
    const service = createEmbeddingService();
    const embedding = await service.embed('Hello, world!');

    expect(embedding).toBeDefined();
    expect(embedding.length).toBe(384); // multilingual-e5-small dimension
    expect(embedding.every((v) => typeof v === 'number')).toBe(true);
  });

  it.skip('should generate normalized embeddings', async () => {
    // Skipped: requires network access to download model
    const service = createEmbeddingService();
    const embedding = await service.embed('Test email content');

    // Calculate magnitude
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

    // Should be approximately 1.0 (normalized)
    expect(magnitude).toBeCloseTo(1.0, 2);
  });

  it.skip('should generate similar embeddings for similar text', async () => {
    // Skipped: requires network access to download model
    const service = createEmbeddingService();

    const emb1 = await service.embed('Your invoice for December');
    const emb2 = await service.embed('Receipt for payment in December');
    const emb3 = await service.embed('Meeting scheduled for tomorrow');

    const sim12 = service.similarity(emb1, emb2);
    const sim13 = service.similarity(emb1, emb3);

    // Invoice/receipt should be more similar than invoice/meeting
    expect(sim12).toBeGreaterThan(sim13);
    expect(sim12).toBeGreaterThan(0.5); // Should be fairly similar
  });

  it('should calculate cosine similarity correctly', () => {
    const service = createEmbeddingService();

    // Identical vectors
    const v1 = [1, 0, 0];
    expect(service.similarity(v1, v1)).toBeCloseTo(1.0);

    // Orthogonal vectors (normalized)
    const v2 = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
    const v3 = [1 / Math.sqrt(2), -1 / Math.sqrt(2), 0];
    expect(service.similarity(v2, v3)).toBeCloseTo(0.0, 2);

    // Opposite vectors
    const v4 = [1, 0, 0];
    const v5 = [-1, 0, 0];
    expect(service.similarity(v4, v5)).toBeCloseTo(-1.0);
  });

  it('should throw on dimension mismatch', () => {
    const service = createEmbeddingService();

    expect(() => {
      service.similarity([1, 2, 3], [1, 2]);
    }).toThrow('dimension mismatch');
  });

  it('should return model identifier', () => {
    const service = createEmbeddingService();
    // Default is the multilingual encoder (most of the mail is French).
    expect(service.getModel()).toBe('Xenova/multilingual-e5-small');
    expect(service.getModelName()).toBe('Xenova/multilingual-e5-small');
  });

  it('keeps the legacy storage key for the English-only model', () => {
    const service = createEmbeddingService({ modelName: 'Xenova/all-MiniLM-L6-v2' });
    expect(service.getModel()).toBe('all-MiniLM-L6-v2');
    expect(service.getModelName()).toBe('Xenova/all-MiniLM-L6-v2');
    expect(embeddingModelKey('Xenova/paraphrase-multilingual-MiniLM-L12-v2')).toBe(
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    );
  });

  it('rejects model ids that could escape the cache directory', () => {
    for (const bad of ['../evil', '/abs/path', 'a\\b', 'Xenova/../x', '']) {
      expect(() => createEmbeddingService({ modelName: bad })).toThrow(/model/i);
    }
  });
});

describe('model input prefix', () => {
  it('adds "query: " for e5 models only', () => {
    expect(prepareModelInput('Xenova/multilingual-e5-small', 'bonjour')).toBe('query: bonjour');
    expect(prepareModelInput('Xenova/multilingual-e5-base', 'bonjour')).toBe('query: bonjour');
    expect(prepareModelInput('Xenova/all-MiniLM-L6-v2', 'bonjour')).toBe('bonjour');
    expect(prepareModelInput('Xenova/paraphrase-multilingual-MiniLM-L12-v2', 'bonjour')).toBe(
      'bonjour',
    );
  });
});

/** Create the files a transformers.js model folder needs. */
function writeModel(root: string, opts: { quantized?: boolean; skip?: string[] } = {}): void {
  const files = requiredModelFiles(opts.quantized ?? true).filter(
    (f) => !(opts.skip ?? []).includes(f),
  );
  for (const rel of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, rel.endsWith('.onnx') ? 'onnx-bytes' : '{}');
  }
}

describe('local encoder (mocked transformers.js)', () => {
  const MODEL = 'Xenova/multilingual-e5-small';
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluribus-enc-'));
    pipelineMock.mockClear();
    extractorMock.mockClear();
    transformersEnv.cacheDir = '/default/cache';
    transformersEnv.localModelPath = '/models/';
    transformersEnv.allowRemoteModels = true;
    transformersEnv.allowLocalModels = false;
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('does nothing until the first embed (no env changes, no model load)', () => {
    createEmbeddingService({ cacheDir });
    expect(pipelineMock).not.toHaveBeenCalled();
    expect(transformersEnv.cacheDir).toBe('/default/cache');
  });

  it('points transformers.js at the cache dir and allows local models', async () => {
    const service = createEmbeddingService({ cacheDir });
    await service.embed('bonjour');
    expect(transformersEnv.cacheDir).toBe(cacheDir);
    expect(transformersEnv.localModelPath).toBe(cacheDir);
    expect(transformersEnv.allowLocalModels).toBe(true);
  });

  it('forbids remote access once the model folder is on disk', async () => {
    writeModel(path.join(cacheDir, MODEL));
    const service = createEmbeddingService({ cacheDir });
    expect(service.isModelCached()).toBe(true);
    await service.embed('bonjour');
    expect(transformersEnv.allowRemoteModels).toBe(false);
  });

  it('allows a one-time download when the model is missing', async () => {
    const service = createEmbeddingService({ cacheDir });
    expect(service.isModelCached()).toBe(false);
    await service.embed('bonjour');
    expect(transformersEnv.allowRemoteModels).toBe(true);
  });

  it('treats an incomplete model folder as missing', async () => {
    writeModel(path.join(cacheDir, MODEL), { skip: ['onnx/model_quantized.onnx'] });
    const service = createEmbeddingService({ cacheDir });
    await service.embed('bonjour');
    expect(transformersEnv.allowRemoteModels).toBe(true);
  });

  it('passes the pinned revision and quantization to the pipeline', async () => {
    const service = createEmbeddingService({ cacheDir, revision: 'abc123', quantized: true });
    await service.embed('bonjour');
    expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', MODEL, {
      quantized: true,
      revision: 'abc123',
    });
  });

  it("defaults to the 'main' revision and a quantized model", async () => {
    const service = createEmbeddingService({ cacheDir });
    await service.embed('bonjour');
    expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', MODEL, {
      quantized: true,
      revision: 'main',
    });
  });

  it('finds a model downloaded under a pinned revision', async () => {
    writeModel(path.join(cacheDir, MODEL, 'abc123'));
    const service = createEmbeddingService({ cacheDir, revision: 'abc123' });
    expect(service.isModelCached()).toBe(true);
    await service.embed('bonjour');
    expect(transformersEnv.allowRemoteModels).toBe(false);
  });

  it('applies the e5 "query: " prefix in the one place that embeds', async () => {
    const service = createEmbeddingService({ cacheDir });
    await service.embed('Facture de mars');
    expect(extractorMock).toHaveBeenCalledWith('query: Facture de mars', {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('does not prefix non-e5 models', async () => {
    const service = createEmbeddingService({ cacheDir, modelName: 'Xenova/all-MiniLM-L6-v2' });
    await service.embed('Facture de mars');
    expect(extractorMock).toHaveBeenCalledWith('Facture de mars', {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('returns a plain number[] and loads the pipeline only once', async () => {
    const service = createEmbeddingService({ cacheDir });
    const [a, b] = await Promise.all([service.embed('un'), service.embed('deux')]);
    expect(Array.isArray(a)).toBe(true);
    expect(a[0]).toBeCloseTo(0.6, 5);
    expect(b).toHaveLength(3);
    await service.embed('trois');
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed load, but not in a tight loop', async () => {
    let clock = 1_000_000;
    pipelineMock.mockRejectedValueOnce(new Error('network down'));
    const service = createEmbeddingService({ cacheDir, now: () => clock });

    await expect(service.embed('un')).rejects.toThrow('network down');
    // Within the cool-down the failure is replayed without touching the network again.
    await expect(service.embed('deux')).rejects.toThrow('network down');
    expect(pipelineMock).toHaveBeenCalledTimes(1);

    clock += 61_000;
    await expect(service.embed('trois')).resolves.toHaveLength(3);
    expect(pipelineMock).toHaveBeenCalledTimes(2);
  });

  it('reset() re-checks the cache on the next embed (after an import)', async () => {
    const service = createEmbeddingService({ cacheDir });
    await service.embed('un');
    expect(transformersEnv.allowRemoteModels).toBe(true);

    writeModel(path.join(cacheDir, MODEL));
    service.reset();
    await service.embed('deux');
    expect(transformersEnv.allowRemoteModels).toBe(false);
    expect(pipelineMock).toHaveBeenCalledTimes(2);
  });
});

describe('isModelCached', () => {
  let cacheDir: string;
  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluribus-cached-'));
  });
  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('is false for an empty cache and true for a complete model folder', () => {
    expect(isModelCached(cacheDir, 'Xenova/multilingual-e5-small')).toBe(false);
    writeModel(path.join(cacheDir, 'Xenova/multilingual-e5-small'));
    expect(isModelCached(cacheDir, 'Xenova/multilingual-e5-small')).toBe(true);
    expect(isModelCached(cacheDir, 'Xenova/all-MiniLM-L6-v2')).toBe(false);
  });

  it('ignores zero-byte files (interrupted copy)', () => {
    const root = path.join(cacheDir, 'Xenova/multilingual-e5-small');
    writeModel(root);
    fs.writeFileSync(path.join(root, 'onnx/model_quantized.onnx'), '');
    expect(isModelCached(cacheDir, 'Xenova/multilingual-e5-small')).toBe(false);
  });

  it('needs the full-precision model when quantization is off', () => {
    const root = path.join(cacheDir, 'Xenova/multilingual-e5-small');
    writeModel(root, { quantized: true });
    expect(isModelCached(cacheDir, 'Xenova/multilingual-e5-small', { quantized: false })).toBe(
      false,
    );
  });
});

describe('importModelFromFolder', () => {
  const MODEL = 'Xenova/multilingual-e5-small';
  let work: string;
  let cacheDir: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'pluribus-import-'));
    cacheDir = path.join(work, 'userData', 'models');
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('copies a model folder into the cache so the encoder can go offline', async () => {
    const src = path.join(work, 'downloaded');
    writeModel(src);
    fs.writeFileSync(path.join(src, 'special_tokens_map.json'), '{"x":1}');
    fs.writeFileSync(path.join(src, 'README.md'), 'ignored');

    const result = await importModelFromFolder(src, cacheDir, MODEL);

    expect(result.dir).toBe(path.join(cacheDir, MODEL));
    expect(isModelCached(cacheDir, MODEL)).toBe(true);
    expect(fs.readFileSync(path.join(cacheDir, MODEL, 'onnx/model_quantized.onnx'), 'utf8')).toBe(
      'onnx-bytes',
    );
    expect(fs.existsSync(path.join(cacheDir, MODEL, 'special_tokens_map.json'))).toBe(true);
    // Only the files the encoder needs are copied.
    expect(fs.existsSync(path.join(cacheDir, MODEL, 'README.md'))).toBe(false);
    expect(result.files).toEqual(
      expect.arrayContaining(['config.json', 'onnx/model_quantized.onnx']),
    );
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('accepts a cache-root folder that contains <org>/<name>', async () => {
    const root = path.join(work, 'cache-root');
    writeModel(path.join(root, MODEL));
    await importModelFromFolder(root, cacheDir, MODEL);
    expect(isModelCached(cacheDir, MODEL)).toBe(true);
  });

  it('validates the folder and names what is missing', async () => {
    const src = path.join(work, 'partial');
    writeModel(src, { skip: ['tokenizer.json', 'onnx/model_quantized.onnx'] });

    await expect(importModelFromFolder(src, cacheDir, MODEL)).rejects.toThrow(
      /tokenizer\.json.*onnx\/model_quantized\.onnx/s,
    );
    expect(fs.existsSync(path.join(cacheDir, MODEL))).toBe(false);
  });

  it('rejects an empty onnx file', async () => {
    const src = path.join(work, 'empty-onnx');
    writeModel(src);
    fs.writeFileSync(path.join(src, 'onnx/model_quantized.onnx'), '');
    await expect(importModelFromFolder(src, cacheDir, MODEL)).rejects.toThrow(/model_quantized/);
  });

  it('rejects a path that is not a folder', async () => {
    const file = path.join(work, 'file.txt');
    fs.writeFileSync(file, 'x');
    await expect(importModelFromFolder(file, cacheDir, MODEL)).rejects.toThrow(/folder/i);
    await expect(importModelFromFolder(path.join(work, 'nope'), cacheDir, MODEL)).rejects.toThrow(
      /folder/i,
    );
  });

  it('leaves no partial files behind and keeps an existing install intact when the copy fails', async () => {
    writeModel(path.join(cacheDir, MODEL));
    const src = path.join(work, 'good');
    writeModel(src);

    // The third file copied fails (disk full).
    const realCopy = fs.promises.copyFile.bind(fs.promises);
    let calls = 0;
    const spy = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to, mode) => {
      calls++;
      if (calls === 3) throw new Error('disk full');
      return realCopy(from, to, mode);
    });

    try {
      await expect(importModelFromFolder(src, cacheDir, MODEL)).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }
    const leftovers = fs
      .readdirSync(path.join(cacheDir, MODEL), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.part'));
    expect(leftovers).toEqual([]);
    expect(isModelCached(cacheDir, MODEL)).toBe(true);
  });

  it('refuses unsafe model ids', async () => {
    const src = path.join(work, 'any');
    writeModel(src);
    await expect(importModelFromFolder(src, cacheDir, '../escape')).rejects.toThrow(/model/i);
  });
});

describe('Vector Serialization', () => {
  it('should serialize and deserialize correctly', () => {
    const original = [0.1, 0.2, 0.3, -0.4, -0.5];
    const serialized = serializeEmbedding(original);
    const deserialized = deserializeEmbedding(serialized);

    expect(deserialized.length).toBe(original.length);
    deserialized.forEach((v, i) => {
      expect(v).toBeCloseTo(original[i], 5);
    });
  });

  it('should handle empty vectors', () => {
    const empty: number[] = [];
    const serialized = serializeEmbedding(empty);
    const deserialized = deserializeEmbedding(serialized);

    expect(deserialized.length).toBe(0);
  });

  it('should use Float32 precision', () => {
    const original = [Math.PI, Math.E, Math.SQRT2];
    const serialized = serializeEmbedding(original);

    // Float32 buffer should be 4 bytes per element
    expect(serialized.length).toBe(original.length * 4);
  });
});

describe('Email Text Preparation', () => {
  it('should combine subject and snippet', () => {
    const result = prepareEmailText('Invoice for December', 'Your payment is due');
    expect(result).toContain('Invoice for December');
    expect(result).toContain('Your payment is due');
  });

  it('should truncate long text', () => {
    const longText = 'x'.repeat(500);
    const result = prepareEmailText('Subject', longText);

    expect(result.length).toBeLessThanOrEqual(400);
  });

  it('should handle empty inputs', () => {
    expect(prepareEmailText('', '')).toBe('');
    expect(prepareEmailText('Subject', '')).toContain('Subject');
    expect(prepareEmailText('', 'Snippet')).toContain('Snippet');
  });
});
