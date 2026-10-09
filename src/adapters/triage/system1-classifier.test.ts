import { describe, it, expect, vi } from 'vitest';
import { withSystem1, type System1ClassifierDeps } from './system1-classifier';
import { EmbeddingModelNotInstalledError } from '../../core/embedding-model';
import { FEATURE_NAMES } from '../../core/system1/features';
import { system1Text } from '../../core/system1/text';
import {
  DEFAULT_SYSTEM1_SETTINGS,
  TRIAGE_FOLDERS,
  type Email,
  type System1Settings,
  type TriageClassificationResult,
  type TriageFolder,
} from '../../core/domain';
import type { PatternMatchResult, System1HeadRepo, TriageClassifier } from '../../core/ports';
import type { HeadRecord } from '../../core/system1/types';

const MODEL = DEFAULT_SYSTEM1_SETTINGS.embeddingModel;
const EMB_DIM = 4;
const INPUT_DIM = EMB_DIM + FEATURE_NAMES.length;

const email = {
  id: 7,
  accountId: 3,
  subject: 'Pourriez-vous confirmer la date ?',
  from: { address: 'alice@example.com', name: 'Alice' },
  to: ['me@test.com'],
  inReplyTo: null,
  listUnsubscribe: null,
} as unknown as Email;

const hint: PatternMatchResult = { folder: 'Planning', confidence: 0.6, tags: [] };

/** Bias-only head: the answer is the same for any input, so tests control confidence directly. */
function biasHead(
  questionId: string,
  kind: 'choice' | 'noul' | 'score',
  labels: string[],
  hot: number,
  strength: number,
  overrides: Partial<HeadRecord> = {},
): HeadRecord {
  return {
    questionId,
    version: 4,
    embeddingModel: MODEL,
    weights: {
      questionId,
      kind,
      labels,
      inputDim: INPUT_DIM,
      W: labels.map(() => new Array<number>(INPUT_DIM).fill(0)),
      b: labels.map((_, i) => (i === hot ? strength : 0)),
      featureNames: [...FEATURE_NAMES],
    },
    threshold: 0.5,
    armed: true,
    metrics: {
      trainSize: 500,
      holdoutSize: 125,
      holdoutAgreement: 0.97,
      coverage: 0.8,
      disagreementUpperBound: 0.04,
      auditCount: 0,
      auditAgreement: null,
    },
    trainedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

const planningIdx = TRIAGE_FOLDERS.indexOf('Planning');

type HeadSet = {
  folder: HeadRecord | null;
  needsReply: HeadRecord | null;
  importance: HeadRecord | null;
};

/** All three heads confidently answer: Planning / needs reply (p~1) / importance 3. */
function confidentHeads(overrides: Partial<HeadSet> = {}): HeadSet {
  return {
    folder: biasHead('folder', 'choice', [...TRIAGE_FOLDERS], planningIdx, 12),
    needsReply: biasHead('needsReply', 'noul', ['false', 'true'], 1, 10),
    importance: biasHead('importance', 'score', ['1', '2', '3', '4'], 2, 10),
    ...overrides,
  };
}

function llmResult(
  overrides: Partial<TriageClassificationResult> = {},
): TriageClassificationResult {
  return {
    folder: 'Planning',
    tags: ['x'],
    confidence: 0.9,
    patternAgreed: true,
    reasoning: 'teacher',
    needsReply: 1,
    importance: 3,
    source: 'llm',
    ...overrides,
  };
}

function setup(
  opts: {
    heads?: HeadSet;
    settings?: Partial<System1Settings>;
    inner?: TriageResultOrFn;
    rng?: () => number;
    embed?: System1ClassifierDeps['embed'];
    withStore?: boolean;
    recordAudit?: System1ClassifierDeps['recordAudit'];
  } = {},
) {
  const headSet = opts.heads ?? confidentHeads();
  const getLatest = vi.fn(async (questionId: string) => {
    return (headSet as Record<string, HeadRecord | null>)[questionId] ?? null;
  });
  const heads = {
    getLatest,
    save: vi.fn(),
    setArmed: vi.fn(),
    updateMetrics: vi.fn(),
  } as unknown as System1HeadRepo;

  const innerFn = vi.fn(async () => {
    const r = opts.inner;
    return typeof r === 'function' ? r() : (r ?? llmResult());
  });
  const inner: TriageClassifier = { classify: innerFn };

  const vector = Float32Array.from([0.5, -0.5, 0.25, 0.1]);
  const embed = vi.fn(opts.embed ?? (async () => vector));
  const storeEmbedding = vi.fn(async () => {});
  const recordAudit = vi.fn(opts.recordAudit ?? (async () => {}));
  const myAddressFor = vi.fn(async () => 'me@test.com');
  const priorRepliesToSender = vi.fn(async () => 2);
  const log = vi.fn();
  let clock = 1_000_000;

  const deps: System1ClassifierDeps = {
    heads,
    embed,
    myAddressFor,
    priorRepliesToSender,
    getSettings: () => ({ ...DEFAULT_SYSTEM1_SETTINGS, ...opts.settings }),
    recordAudit,
    ...(opts.withStore === false ? {} : { storeEmbedding }),
    rng: opts.rng ?? (() => 0.99),
    log,
    now: () => clock,
  };
  const classifier = withSystem1(inner, deps);
  return {
    classifier,
    inner: innerFn,
    embed,
    storeEmbedding,
    recordAudit,
    myAddressFor,
    priorRepliesToSender,
    getLatest,
    log,
    vector,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

type TriageResultOrFn = TriageClassificationResult | (() => TriageClassificationResult);

describe('withSystem1: local answers', () => {
  it('answers locally when all three heads are armed and confident, without calling inner', async () => {
    const t = setup();
    const result = await t.classifier.classify(email, hint, []);

    expect(t.inner).not.toHaveBeenCalled();
    expect(result.source).toBe('system1');
    expect(result.folder).toBe('Planning');
    expect(result.tags).toEqual([]);
    expect(result.importance).toBe(3);
    expect(result.needsReply).toBeGreaterThan(0.99);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.patternHint).toBe('Planning');
    expect(result.patternAgreed).toBe(true);
    expect(result.reasoning).toMatch(/^On-device model \(System 1\): /);
  });

  it('reports disagreement with the pattern hint', async () => {
    const t = setup();
    const result = await t.classifier.classify(email, { ...hint, folder: 'Feed' }, []);
    expect(result.patternHint).toBe('Feed');
    expect(result.patternAgreed).toBe(false);
  });

  it('puts the folder confidence on the result and keeps the reasoning free of mail content', async () => {
    const t = setup();
    const result = await t.classifier.classify(email, hint, [], {
      bodyPreview: 'SECRET-BODY-TEXT',
    });
    expect(result.reasoning).not.toContain('SECRET-BODY-TEXT');
    expect(result.reasoning).not.toContain('alice@example.com');
    expect(result.reasoning).not.toContain('confirmer');
  });

  it('returns needsReply as a probability, not a boolean', async () => {
    const t = setup({
      heads: confidentHeads({
        needsReply: biasHead('needsReply', 'noul', ['false', 'true'], 0, 6),
      }),
    });
    const result = await t.classifier.classify(email, hint, []);
    expect(result.source).toBe('system1');
    expect(result.needsReply).toBeGreaterThan(0);
    expect(result.needsReply).toBeLessThan(0.01);
  });
});

describe('withSystem1: embedding and features', () => {
  it('embeds the canonical System 1 text including the body preview, and stores the vector', async () => {
    const t = setup();
    await t.classifier.classify(email, hint, [], { bodyPreview: 'Bonjour, voici le texte.' });

    expect(t.embed).toHaveBeenCalledTimes(1);
    expect(t.embed).toHaveBeenCalledWith(system1Text(email, 'Bonjour, voici le texte.'));
    expect(t.storeEmbedding).toHaveBeenCalledWith(7, t.vector);
  });

  it('works without a body preview', async () => {
    const t = setup();
    await t.classifier.classify(email, hint, []);
    expect(t.embed).toHaveBeenCalledWith(system1Text(email, undefined));
  });

  it('looks up the sender context for the feature vector', async () => {
    const t = setup();
    await t.classifier.classify(email, hint, []);
    expect(t.myAddressFor).toHaveBeenCalledWith(3);
    // As of the email's date, like training: a backlog email must not see later replies.
    expect(t.priorRepliesToSender).toHaveBeenCalledWith(3, 'alice@example.com', email.date);
  });

  it('still stores the embedding when no head exists yet (so training can start)', async () => {
    const t = setup({ heads: { folder: null, needsReply: null, importance: null } });
    const result = await t.classifier.classify(email, hint, []);
    expect(t.storeEmbedding).toHaveBeenCalledWith(7, t.vector);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
    expect(t.myAddressFor).not.toHaveBeenCalled();
  });

  it('survives a failing storeEmbedding', async () => {
    const t = setup();
    t.storeEmbedding.mockRejectedValueOnce(new Error('disk full'));
    const result = await t.classifier.classify(email, hint, []);
    expect(result.source).toBe('system1');
    expect(t.log).toHaveBeenCalled();
  });

  it('works without a storeEmbedding dependency', async () => {
    const t = setup({ withStore: false });
    const result = await t.classifier.classify(email, hint, []);
    expect(result.source).toBe('system1');
  });
});

describe('withSystem1: escalation to System 2', () => {
  it('calls inner when a head is unarmed', async () => {
    const t = setup({
      heads: confidentHeads({
        importance: biasHead('importance', 'score', ['1', '2', '3', '4'], 2, 10, { armed: false }),
      }),
    });
    const result = await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
    expect(result.reasoning).toBe('teacher');
  });

  it('calls inner when a head is missing', async () => {
    const t = setup({ heads: confidentHeads({ folder: null }) });
    await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
  });

  it('calls inner when confidence is below the head threshold', async () => {
    const t = setup({
      heads: confidentHeads({
        needsReply: biasHead('needsReply', 'noul', ['false', 'true'], 1, 0.2), // p~0.55: unsure
      }),
    });
    const result = await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
  });

  it('calls inner when a head was trained on a different encoder', async () => {
    const t = setup({
      heads: confidentHeads({
        folder: biasHead('folder', 'choice', [...TRIAGE_FOLDERS], planningIdx, 12, {
          embeddingModel: 'Xenova/all-MiniLM-L6-v2',
        }),
      }),
    });
    await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
  });

  it('calls inner when the head input dimension does not match the embedding', async () => {
    const t = setup({ embed: async () => new Float32Array(EMB_DIM + 10) });
    await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
  });

  it('forwards the original arguments to inner untouched', async () => {
    const t = setup({ heads: { folder: null, needsReply: null, importance: null } });
    await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenLastCalledWith(email, hint, []);
    await t.classifier.classify(email, hint, [], { bodyPreview: 'x' });
    expect(t.inner).toHaveBeenLastCalledWith(email, hint, [], { bodyPreview: 'x' });
  });

  it('logs shadow agreement (and records nothing) when heads exist but do not answer', async () => {
    const t = setup({
      heads: confidentHeads({
        folder: biasHead('folder', 'choice', [...TRIAGE_FOLDERS], planningIdx, 12, {
          armed: false,
        }),
      }),
    });
    await t.classifier.classify(email, hint, []);
    expect(t.recordAudit).not.toHaveBeenCalled();
    const shadow = t.log.mock.calls.find(([msg]) => /shadow/i.test(String(msg)));
    expect(shadow).toBeDefined();
    expect(shadow![1]).toMatchObject({ folder: true });
  });
});

describe('withSystem1: forced System 2, settings and errors', () => {
  it('goes straight to inner (no embedding) when forceSystem2 is set', async () => {
    const t = setup();
    const result = await t.classifier.classify(email, hint, [], { forceSystem2: true });
    expect(t.inner).toHaveBeenCalledWith(email, hint, [], { forceSystem2: true });
    expect(t.embed).not.toHaveBeenCalled();
    expect(t.storeEmbedding).not.toHaveBeenCalled();
    expect(t.getLatest).not.toHaveBeenCalled();
    expect(result.source).toBe('llm');
  });

  it('goes straight to inner when System 1 is disabled', async () => {
    const t = setup({ settings: { enabled: false } });
    await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(t.embed).not.toHaveBeenCalled();
  });

  it('falls back to inner when embedding fails', async () => {
    const t = setup({
      embed: async () => {
        throw new Error('model not loaded');
      },
    });
    const result = await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
    expect(t.log).toHaveBeenCalledWith(expect.stringMatching(/error|fail/i), expect.anything());
  });

  it('escalates quietly while the on-device model is not installed (no log, no stored vector)', async () => {
    const t = setup({
      embed: async () => {
        throw new EmbeddingModelNotInstalledError(MODEL);
      },
    });

    for (let i = 0; i < 3; i++) {
      const result = await t.classifier.classify(email, hint, []);
      expect(result.source).toBe('llm');
    }

    expect(t.inner).toHaveBeenCalledTimes(3);
    expect(t.embed).toHaveBeenCalledTimes(3);
    expect(t.log).not.toHaveBeenCalled();
    expect(t.storeEmbedding).not.toHaveBeenCalled();
    expect(t.recordAudit).not.toHaveBeenCalled();
  });

  it('passes the options (body preview) to inner unchanged when the model is missing', async () => {
    const t = setup({
      embed: async () => {
        throw new EmbeddingModelNotInstalledError(MODEL);
      },
    });
    const opts = { bodyPreview: 'Bonjour' };
    await t.classifier.classify(email, hint, [], opts);
    expect(t.inner).toHaveBeenCalledWith(email, hint, [], opts);
  });

  it('keeps answering locally once the model is installed (no stale "missing" state)', async () => {
    let installed = false;
    const t = setup({
      embed: async () => {
        if (!installed) throw new EmbeddingModelNotInstalledError(MODEL);
        return Float32Array.from([0.5, -0.5, 0.25, 0.1]);
      },
    });

    expect((await t.classifier.classify(email, hint, [])).source).toBe('llm');
    installed = true;
    expect((await t.classifier.classify(email, hint, [])).source).toBe('system1');
    expect(t.inner).toHaveBeenCalledTimes(1);
  });

  it('falls back to inner when loading the heads fails', async () => {
    const t = setup();
    t.getLatest.mockRejectedValue(new Error('db locked'));
    const result = await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
  });

  it('falls back to inner when the feature lookups fail', async () => {
    const t = setup();
    t.priorRepliesToSender.mockRejectedValue(new Error('sql'));
    const result = await t.classifier.classify(email, hint, []);
    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
  });

  it('falls back to inner when settings cannot be read', async () => {
    const inner = vi.fn(async () => llmResult());
    const classifier = withSystem1(
      { classify: inner },
      {
        heads: { getLatest: vi.fn() } as unknown as System1HeadRepo,
        embed: vi.fn(),
        myAddressFor: vi.fn(),
        priorRepliesToSender: vi.fn(),
        getSettings: () => {
          throw new Error('config unavailable');
        },
        recordAudit: vi.fn(),
      },
    );
    await classifier.classify(email, hint, []);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('does not call inner twice when inner itself fails', async () => {
    const t = setup({
      inner: () => {
        throw new Error('llm down');
      },
      heads: { folder: null, needsReply: null, importance: null },
    });
    await expect(t.classifier.classify(email, hint, [])).rejects.toThrow('llm down');
    expect(t.inner).toHaveBeenCalledTimes(1);
  });
});

describe('withSystem1: audits', () => {
  it('re-checks a confident answer with inner at the audit rate, records agreement and returns the teacher result', async () => {
    const teacher = llmResult({
      folder: 'Planning',
      needsReply: 1,
      importance: 3,
      reasoning: 'teacher',
    });
    const t = setup({ rng: () => 0, inner: teacher });
    const result = await t.classifier.classify(email, hint, []);

    expect(t.inner).toHaveBeenCalledTimes(1);
    expect(result).toBe(teacher);
    expect(t.recordAudit).toHaveBeenCalledTimes(3);
    expect(t.recordAudit).toHaveBeenCalledWith({ questionId: 'folder', version: 4, agreed: true });
    expect(t.recordAudit).toHaveBeenCalledWith({
      questionId: 'needsReply',
      version: 4,
      agreed: true,
    });
    expect(t.recordAudit).toHaveBeenCalledWith({
      questionId: 'importance',
      version: 4,
      agreed: true,
    });
  });

  it('records disagreements; importance agrees within one level', async () => {
    const teacher = llmResult({ folder: 'Feed', needsReply: 0, importance: 4 }); // S1: Planning / true / 3
    const t = setup({ rng: () => 0, inner: teacher });
    await t.classifier.classify(email, hint, []);
    expect(t.recordAudit).toHaveBeenCalledWith({ questionId: 'folder', version: 4, agreed: false });
    expect(t.recordAudit).toHaveBeenCalledWith({
      questionId: 'needsReply',
      version: 4,
      agreed: false,
    });
    expect(t.recordAudit).toHaveBeenCalledWith({
      questionId: 'importance',
      version: 4,
      agreed: true,
    });

    const far = setup({ rng: () => 0, inner: llmResult({ importance: 1 }) });
    await far.classifier.classify(email, hint, []);
    expect(far.recordAudit).toHaveBeenCalledWith({
      questionId: 'importance',
      version: 4,
      agreed: false,
    });
  });

  it('thresholds the teacher needsReply probability at 0.5', async () => {
    const t = setup({ rng: () => 0, inner: llmResult({ needsReply: 0.8 }) });
    await t.classifier.classify(email, hint, []);
    expect(t.recordAudit).toHaveBeenCalledWith({
      questionId: 'needsReply',
      version: 4,
      agreed: true,
    });
    const low = setup({ rng: () => 0, inner: llmResult({ needsReply: 0.3 }) });
    await low.classifier.classify(email, hint, []);
    expect(low.recordAudit).toHaveBeenCalledWith({
      questionId: 'needsReply',
      version: 4,
      agreed: false,
    });
  });

  it('skips audit entries for fields the teacher did not return', async () => {
    const teacher: TriageClassificationResult = {
      folder: 'Planning',
      tags: [],
      confidence: 0.9,
      patternAgreed: true,
      reasoning: 't',
      source: 'llm',
    };
    const t = setup({ rng: () => 0, inner: teacher });
    await t.classifier.classify(email, hint, []);
    expect(t.recordAudit).toHaveBeenCalledTimes(1);
    expect(t.recordAudit).toHaveBeenCalledWith({ questionId: 'folder', version: 4, agreed: true });
  });

  it('does not audit at all when the random draw is above the audit rate', async () => {
    const t = setup({ rng: () => 0.2, settings: { auditRate: 0.05 } });
    const result = await t.classifier.classify(email, hint, []);
    expect(t.inner).not.toHaveBeenCalled();
    expect(result.source).toBe('system1');
    expect(t.recordAudit).not.toHaveBeenCalled();
  });

  it('audits every confident answer when the audit rate is 1 and never when it is 0', async () => {
    const always = setup({ rng: () => 0.9999, settings: { auditRate: 1 } });
    await always.classifier.classify(email, hint, []);
    expect(always.inner).toHaveBeenCalledTimes(1);

    const never = setup({ rng: () => 0, settings: { auditRate: 0 } });
    const result = await never.classifier.classify(email, hint, []);
    expect(never.inner).not.toHaveBeenCalled();
    expect(result.source).toBe('system1');
  });

  it('does not count a fallback (non-LLM) result as an audit and answers with System 1 instead', async () => {
    const fallback = llmResult({ source: 'fallback', folder: 'Review', reasoning: 'LLM error' });
    const t = setup({ rng: () => 0, inner: fallback });
    const result = await t.classifier.classify(email, hint, []);
    expect(t.recordAudit).not.toHaveBeenCalled();
    expect(result.source).toBe('system1');
    expect(result.folder).toBe('Planning');
  });

  it('answers with System 1 when the audit call to inner throws', async () => {
    const t = setup({
      rng: () => 0,
      inner: () => {
        throw new Error('llm down');
      },
    });
    const result = await t.classifier.classify(email, hint, []);
    expect(result.source).toBe('system1');
    expect(t.recordAudit).not.toHaveBeenCalled();
  });

  it('never fails the classification because recording an audit failed', async () => {
    const teacher = llmResult();
    const t = setup({
      rng: () => 0,
      inner: teacher,
      recordAudit: async () => {
        throw new Error('db locked');
      },
    });
    const result = await t.classifier.classify(email, hint, []);
    expect(result).toBe(teacher);
    expect(t.log).toHaveBeenCalled();
  });

  it('passes the caller options to inner during an audit', async () => {
    const t = setup({ rng: () => 0 });
    await t.classifier.classify(email, hint, [], { bodyPreview: 'hello' });
    expect(t.inner).toHaveBeenCalledWith(email, hint, [], { bodyPreview: 'hello' });
  });
});

describe('withSystem1: head cache', () => {
  it('loads each head once within the TTL, then refreshes', async () => {
    const t = setup();
    await t.classifier.classify(email, hint, []);
    await t.classifier.classify(email, hint, []);
    expect(t.getLatest).toHaveBeenCalledTimes(3);

    t.advance(61_000);
    await t.classifier.classify(email, hint, []);
    expect(t.getLatest).toHaveBeenCalledTimes(6);
  });

  it('reloads right after an audit so a disarm takes effect immediately', async () => {
    const t = setup({ rng: () => 0 });
    await t.classifier.classify(email, hint, []);
    expect(t.getLatest).toHaveBeenCalledTimes(3);
    await t.classifier.classify(email, hint, []);
    expect(t.getLatest).toHaveBeenCalledTimes(6);
  });

  it('picks up a newly trained head after the TTL', async () => {
    const heads = confidentHeads({ folder: null });
    const t = setup({ heads });
    expect((await t.classifier.classify(email, hint, [])).source).toBe('llm');
    heads.folder = biasHead('folder', 'choice', [...TRIAGE_FOLDERS], planningIdx, 12, {
      version: 5,
    });
    t.advance(61_000);
    expect((await t.classifier.classify(email, hint, [])).source).toBe('system1');
  });

  it('shares one load between concurrent classifications', async () => {
    const t = setup();
    await Promise.all([
      t.classifier.classify(email, hint, []),
      t.classifier.classify(email, hint, []),
      t.classifier.classify(email, hint, []),
    ]);
    expect(t.getLatest).toHaveBeenCalledTimes(3);
  });
});

describe('withSystem1: result typing', () => {
  it('only ever emits triage folders', async () => {
    const t = setup();
    const result = await t.classifier.classify(email, hint, []);
    expect(TRIAGE_FOLDERS).toContain(result.folder as TriageFolder);
  });
});
