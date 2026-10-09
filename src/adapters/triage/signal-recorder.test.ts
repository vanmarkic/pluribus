import { describe, it, expect, vi, afterEach } from 'vitest';
import { withSignalRecording } from './signal-recorder';
import type { SignalRepo, TriageClassifier } from '../../core/ports';
import type { Email, TriageClassificationResult } from '../../core/domain';

const email = { id: 42, accountId: 1 } as Email;
const hint = { folder: 'INBOX' as const, confidence: 0.5, tags: [] };

function result(overrides: Partial<TriageClassificationResult> = {}): TriageClassificationResult {
  return {
    folder: 'Planning',
    tags: [],
    confidence: 0.83,
    patternAgreed: true,
    reasoning: 'r',
    ...overrides,
  };
}

function makeSignals(upsert?: SignalRepo['upsert']) {
  const fn = vi.fn(upsert ?? (async () => {}));
  const repo: SignalRepo = {
    upsert: fn,
    get: vi.fn(async () => null),
    getEffective: vi.fn(async () => null),
    listByEmail: vi.fn(async () => []),
    listBySource: vi.fn(async () => []),
  };
  return { repo, upsert: fn };
}

function innerReturning(r: TriageClassificationResult) {
  const classify = vi.fn(async () => r);
  const inner: TriageClassifier = { classify };
  return { inner, classify };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withSignalRecording', () => {
  it('records a system2 signal for an llm result', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(
      result({ source: 'llm', needsReply: 1, importance: 3, confidence: 0.9, folder: 'INBOX' }),
    );
    const classifier = withSignalRecording(inner, repo, { modelVersion: () => 'claude-haiku-4-5' });

    await classifier.classify(email, hint, []);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      emailId: 42,
      source: 'system2',
      needsReply: 1,
      importance: 3,
      folder: 'INBOX',
      confidence: 0.9,
      modelVersion: 'claude-haiku-4-5',
    });
  });

  it('records needsReply=0 as 0 (not null)', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(result({ source: 'llm', needsReply: 0, importance: 1 }));
    await withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(email, hint, []);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ needsReply: 0, importance: 1 }));
  });

  it('stores nulls for signals the model did not return', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(result({ source: 'llm' }));
    await withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(email, hint, []);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'system2', needsReply: null, importance: null }),
    );
  });

  it('records a system1 signal for a system1 result', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(
      result({ source: 'system1', needsReply: 0.12, importance: 2, confidence: 0.97 }),
    );
    await withSignalRecording(inner, repo, {
      modelVersion: () => 'claude-haiku-4-5',
      system1ModelVersion: () => 'system1:Xenova/multilingual-e5-small',
    }).classify(email, hint, []);
    expect(upsert).toHaveBeenCalledWith({
      emailId: 42,
      source: 'system1',
      needsReply: 0.12,
      importance: 2,
      folder: 'Planning',
      confidence: 0.97,
      modelVersion: 'system1:Xenova/multilingual-e5-small',
    });
  });

  it('defaults the system1 model version to "system1", not the LLM model id', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(result({ source: 'system1' }));
    await withSignalRecording(inner, repo, { modelVersion: () => 'claude-haiku-4-5' }).classify(
      email,
      hint,
      [],
    );
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ modelVersion: 'system1' }));
  });

  it('keeps recording the LLM model id for system2 even when a system1 version is set', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(result({ source: 'llm' }));
    await withSignalRecording(inner, repo, {
      modelVersion: () => 'mistral:7b',
      system1ModelVersion: () => 'system1:x',
    }).classify(email, hint, []);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'system2', modelVersion: 'mistral:7b' }),
    );
  });

  it('records nothing for a fallback result', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(result({ source: 'fallback', needsReply: 1, importance: 4 }));
    await withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(email, hint, []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('records nothing when the result has no source', async () => {
    const { repo, upsert } = makeSignals();
    const { inner } = innerReturning(result());
    await withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(email, hint, []);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns the inner result untouched', async () => {
    const { repo } = makeSignals();
    const r = result({ source: 'llm', needsReply: 1 });
    const { inner } = innerReturning(r);
    const out = await withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(
      email,
      hint,
      [],
    );
    expect(out).toBe(r);
  });

  it('does not throw when recording fails (logs and continues)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { repo, upsert } = makeSignals(async () => {
      throw new Error('disk full');
    });
    const r = result({ source: 'llm', needsReply: 1, importance: 3 });
    const { inner } = innerReturning(r);

    const out = await withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(
      email,
      hint,
      [],
    );

    expect(out).toBe(r);
    expect(upsert).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('does not throw when the model version lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { repo, upsert } = makeSignals();
    const r = result({ source: 'llm' });
    const { inner } = innerReturning(r);
    const out = await withSignalRecording(inner, repo, {
      modelVersion: () => {
        throw new Error('config unavailable');
      },
    }).classify(email, hint, []);
    expect(out).toBe(r);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('propagates classification errors (nothing to record)', async () => {
    const { repo, upsert } = makeSignals();
    const inner: TriageClassifier = {
      classify: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await expect(
      withSignalRecording(inner, repo, { modelVersion: () => 'm' }).classify(email, hint, []),
    ).rejects.toThrow('boom');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('forwards the options to the inner classifier and reads the model version per call', async () => {
    const { repo, upsert } = makeSignals();
    const { inner, classify } = innerReturning(result({ source: 'llm' }));
    let model = 'mistral:7b';
    const classifier = withSignalRecording(inner, repo, { modelVersion: () => model });

    await classifier.classify(email, hint, [], { bodyPreview: 'hi', forceSystem2: true });
    expect(classify).toHaveBeenLastCalledWith(email, hint, [], {
      bodyPreview: 'hi',
      forceSystem2: true,
    });
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelVersion: 'mistral:7b' }),
    );

    model = 'claude-haiku-4-5';
    await classifier.classify(email, hint, []);
    expect(classify).toHaveBeenLastCalledWith(email, hint, []);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelVersion: 'claude-haiku-4-5' }),
    );
  });
});
