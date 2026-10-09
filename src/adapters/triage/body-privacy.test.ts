/**
 * Privacy gate for body previews: they reach an LLM only when the provider is
 * local (Ollama) or the user explicitly opted in to cloud excerpts.
 */

import { describe, it, expect, vi } from 'vitest';
import { withBodyPrivacy } from './body-privacy';
import { withSignalRecording } from './signal-recorder';
import { createEnhancedTriageClassifier } from './enhanced-classifier';
import type { LLMConfig, SignalRepo, TriageClassifier, VectorSearch } from '../../core/ports';
import type { Email, TriageClassificationResult } from '../../core/domain';

const email = {
  id: 7,
  accountId: 1,
  subject: 'Budget',
  snippet: '',
  from: { address: 'alice@example.com', name: 'Alice' },
  date: new Date('2026-06-12T10:00:00.000Z'),
} as Email;
const hint = { folder: 'INBOX' as const, confidence: 0.5, tags: [] };
const classified: TriageClassificationResult = {
  folder: 'INBOX',
  tags: [],
  confidence: 0.9,
  patternAgreed: true,
  reasoning: 'r',
  source: 'llm',
};

function config(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    dailyBudget: 100,
    dailyEmailLimit: 1000,
    autoClassify: true,
    confidenceThreshold: 0.85,
    reclassifyCooldownDays: 7,
    ...overrides,
  };
}

function makeInner() {
  const classify = vi.fn(async () => classified);
  const inner: TriageClassifier = { classify };
  return { inner, classify };
}

describe('withBodyPrivacy', () => {
  it('strips bodyPreview for anthropic when the cloud flag is off or absent', async () => {
    for (const cfg of [config(), config({ sendBodyExcerptsToCloud: false })]) {
      const { inner, classify } = makeInner();
      await withBodyPrivacy(inner, () => cfg).classify(email, hint, [], {
        bodyPreview: 'secret body',
      });
      const passed = (classify.mock.calls[0] as unknown[])[3] as
        | Record<string, unknown>
        | undefined;
      expect(passed?.bodyPreview).toBeUndefined();
      expect(JSON.stringify(passed ?? {})).not.toContain('secret body');
    }
  });

  it('passes bodyPreview through for ollama', async () => {
    const { inner, classify } = makeInner();
    await withBodyPrivacy(inner, () => config({ provider: 'ollama' })).classify(email, hint, [], {
      bodyPreview: 'secret body',
    });
    expect((classify.mock.calls[0] as unknown[])[3]).toEqual({ bodyPreview: 'secret body' });
  });

  it('passes bodyPreview through for anthropic when the user opted in', async () => {
    const { inner, classify } = makeInner();
    await withBodyPrivacy(inner, () => config({ sendBodyExcerptsToCloud: true })).classify(
      email,
      hint,
      [],
      { bodyPreview: 'secret body' },
    );
    expect((classify.mock.calls[0] as unknown[])[3]).toEqual({ bodyPreview: 'secret body' });
  });

  it('keeps the other options when stripping', async () => {
    const { inner, classify } = makeInner();
    await withBodyPrivacy(inner, () => config()).classify(email, hint, [], {
      bodyPreview: 'secret body',
      forceSystem2: true,
    });
    expect((classify.mock.calls[0] as unknown[])[3]).toEqual({ forceSystem2: true });
  });

  it('passes calls without options straight through', async () => {
    const { inner, classify } = makeInner();
    const getLLMConfig = vi.fn(() => config());
    const out = await withBodyPrivacy(inner, getLLMConfig).classify(email, hint, []);
    expect(out).toBe(classified);
    expect(classify).toHaveBeenCalledWith(email, hint, []);
  });

  it('reads the config on every call, so setting changes apply immediately', async () => {
    const { inner, classify } = makeInner();
    let cfg = config();
    const classifier = withBodyPrivacy(inner, () => cfg);

    await classifier.classify(email, hint, [], { bodyPreview: 'one' });
    expect(
      ((classify.mock.calls[0] as unknown[])[3] as object | undefined) ?? {},
    ).not.toHaveProperty('bodyPreview');

    cfg = config({ sendBodyExcerptsToCloud: true });
    await classifier.classify(email, hint, [], { bodyPreview: 'two' });
    expect((classify.mock.calls[1] as unknown[])[3]).toEqual({ bodyPreview: 'two' });
  });

  it('fails closed when the config cannot be read', async () => {
    const { inner, classify } = makeInner();
    await withBodyPrivacy(inner, () => {
      throw new Error('store locked');
    }).classify(email, hint, [], { bodyPreview: 'secret body' });
    const passed = (classify.mock.calls[0] as unknown[])[3] as Record<string, unknown> | undefined;
    expect(passed?.bodyPreview).toBeUndefined();
  });

  it('treats an unknown provider like a cloud provider', async () => {
    const { inner, classify } = makeInner();
    await withBodyPrivacy(inner, () => config({ provider: 'mystery' as never })).classify(
      email,
      hint,
      [],
      { bodyPreview: 'secret body' },
    );
    const passed = (classify.mock.calls[0] as unknown[])[3] as Record<string, unknown> | undefined;
    expect(passed?.bodyPreview).toBeUndefined();
  });
});

describe('privacy invariant: no body text reaches an LLM prompt', () => {
  const BODY = 'Zebra-quartz-7731: the merger closes on Friday, please confirm your share.';

  function fakeLlm() {
    const prompts: string[] = [];
    return {
      prompts,
      complete: vi.fn(async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ folder: 'INBOX', tags: [], confidence: 0.9, reasoning: 'x' });
      }),
    };
  }

  const vectorSearchStub: VectorSearch = {
    findSimilar: vi.fn(async () => []),
    calculateConfidence: vi.fn(() => null),
    indexEmail: vi.fn(async () => {}),
  } as unknown as VectorSearch;

  it('anthropic without the opt-in: the body never appears in any prompt', async () => {
    const llm = fakeLlm();
    const classifier = withBodyPrivacy(createEnhancedTriageClassifier(llm, vectorSearchStub), () =>
      config({ provider: 'anthropic' }),
    );

    await classifier.classify(email, hint, [], { bodyPreview: BODY });
    await classifier.classify(email, hint, [], { bodyPreview: BODY, forceSystem2: true });

    expect(llm.prompts).toHaveLength(2);
    for (const prompt of llm.prompts) {
      expect(prompt).not.toContain('Zebra-quartz-7731');
      expect(prompt).not.toContain('merger');
      expect(prompt).not.toContain('email_body_excerpt');
    }
  });

  it('holds when composed with signal recording as in the container', async () => {
    const llm = fakeLlm();
    const signals = { upsert: vi.fn(async () => {}) } as unknown as SignalRepo;
    const classifier = withSignalRecording(
      withBodyPrivacy(createEnhancedTriageClassifier(llm, vectorSearchStub), () => config()),
      signals,
      { modelVersion: () => 'claude-haiku-4-5' },
    );
    await classifier.classify(email, hint, [], { bodyPreview: BODY });
    expect(llm.prompts[0]).not.toContain('Zebra-quartz-7731');
  });

  it('control: ollama does receive the excerpt, so the test can fail', async () => {
    const llm = fakeLlm();
    const classifier = withBodyPrivacy(createEnhancedTriageClassifier(llm, vectorSearchStub), () =>
      config({ provider: 'ollama' }),
    );
    await classifier.classify(email, hint, [], { bodyPreview: BODY });
    expect(llm.prompts[0]).toContain('Zebra-quartz-7731');
  });

  it('control: anthropic with the opt-in receives the excerpt', async () => {
    const llm = fakeLlm();
    const classifier = withBodyPrivacy(createEnhancedTriageClassifier(llm, vectorSearchStub), () =>
      config({ sendBodyExcerptsToCloud: true }),
    );
    await classifier.classify(email, hint, [], { bodyPreview: BODY });
    expect(llm.prompts[0]).toContain('Zebra-quartz-7731');
  });
});
