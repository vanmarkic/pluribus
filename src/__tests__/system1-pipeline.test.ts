/**
 * System 1 in the real triage stack.
 *
 * The decorators are the real ones, composed by the same function the app uses
 * (`composeTriageClassifier`): signal recording outermost, then System 1, then
 * body privacy, then the enhanced classifier. Only the edges are fake: the LLM
 * client (a spy that records every prompt), the sentence encoder (deterministic
 * vectors, no Hugging Face), and the clock/rng. Storage is the real SQLite
 * schema in memory.
 *
 * What this proves that the unit tests of each piece cannot:
 * - an armed, confident System 1 answers WITHOUT calling the LLM, and its
 *   answer is recorded as a `system1` signal;
 * - anything else (unarmed, unsure, audit, forced, error) reaches the LLM;
 * - the privacy invariant survives the extra layer: System 1 sees body
 *   previews (it is on-device), the LLM prompt does not unless the provider is
 *   local or the user opted in to cloud excerpts;
 * - the whole loop works: LLM answers become training labels, the heads arm,
 *   and System 1 then stands in for the LLM;
 * - training and inference count "prior replies to this sender" identically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { initDb, getDb, closeDb } from '../adapters/db/connection';
import { createAccountRepo } from '../adapters/db/account-repo';
import { createSignalRepo } from '../adapters/db/email-signals-repo';
import { createSystem1HeadRepo } from '../adapters/db/system1-heads-repo';
import { createSystem1TrainingRepo } from '../adapters/db/system1-training-repo';
import { createEmbeddingRepo } from '../adapters/embeddings/embedding-repo';
import { createVectorSearch } from '../adapters/embeddings/vector-search';
import { createPriorRepliesCounter } from '../adapters/embeddings/sender-history';
import { composeTriageClassifier } from '../main/triage-composition';
import { recordSystem1Audit, trainSystem1 } from '../core/usecases/system1-usecases';
import { EmbeddingModelNotInstalledError } from '../core/embedding-model';
import { FEATURE_NAMES } from '../core/system1/features';
import { EMAIL_QUESTIONS, type HeadRecord } from '../core/system1/types';
import {
  DEFAULT_SYSTEM1_SETTINGS,
  TRIAGE_FOLDERS,
  type Email,
  type System1Settings,
  type TriageClassificationResult,
} from '../core/domain';
import type { ConfigStore, EmbeddingService, LLMConfig, PatternMatchResult } from '../core/ports';

const SCHEMA_PATH = path.join(__dirname, '../adapters/db/schema.sql');
const MODEL = DEFAULT_SYSTEM1_SETTINGS.embeddingModel;
const SYSTEM1_VERSION = `system1:${MODEL}`;

const hint: PatternMatchResult = { folder: 'Planning', confidence: 0.6, tags: [] };

// ---------------------------------------------------------------------------
// Fakes at the edges
// ---------------------------------------------------------------------------

type Encoder = EmbeddingService & { calls: string[] };

/** A deterministic encoder. `vectorFor` decides the vector; every input text is recorded. */
function createEncoder(vectorFor: (text: string) => number[], model: string = MODEL): Encoder {
  const calls: string[] = [];
  return {
    calls,
    embed: async (text) => {
      calls.push(text);
      return vectorFor(text);
    },
    similarity: (a, b) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0),
    getModel: () => model,
  };
}

type LlmAnswer = Partial<Record<string, unknown>>;

const TEACHER_AGREES: LlmAnswer = {
  folder: 'Planning',
  tags: [],
  confidence: 0.9,
  patternAgreed: true,
  needsReply: true,
  importance: 3,
  reasoning: 'teacher',
};

/** An LLM client spy: records every prompt, answers with `answer(prompt)`. */
function createLlm(answer: (prompt: string) => LlmAnswer = () => TEACHER_AGREES) {
  const prompts: string[] = [];
  const complete = vi.fn(async (prompt: string) => {
    prompts.push(prompt);
    return JSON.stringify(answer(prompt));
  });
  return { prompts, complete };
}

// ---------------------------------------------------------------------------
// Real storage
// ---------------------------------------------------------------------------

let uid = 0;

function seedAccount(): void {
  const db = getDb();
  db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
           VALUES ('Me', 'me@test.com', 'imap.test.com', 'smtp.test.com', 'me')`);
  db.exec(
    `INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox'), (1, 'Sent', 'Sent')`,
  );
}

function insertEmail(
  o: {
    subject?: string;
    from?: string;
    snippet?: string;
    date?: Date;
  } = {},
): Email {
  uid++;
  const date = o.date ?? new Date('2026-09-01T10:00:00.000Z');
  const from = o.from ?? 'alice@example.com';
  const subject = o.subject ?? 'Pourriez-vous confirmer la date ?';
  const snippet = o.snippet ?? '';
  const result = getDb()
    .prepare(
      `INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, from_name,
                           to_addresses, date, snippet)
       VALUES (?, 1, 1, ?, ?, ?, 'Alice', ?, ?, ?)`,
    )
    .run(
      `<m${uid}@x>`,
      uid,
      subject,
      from,
      JSON.stringify(['me@test.com']),
      date.toISOString(),
      snippet,
    );
  return {
    id: Number(result.lastInsertRowid),
    messageId: `<m${uid}@x>`,
    accountId: 1,
    folderId: 1,
    uid,
    subject,
    from: { address: from, name: 'Alice' },
    to: ['me@test.com'],
    date,
    snippet,
    sizeBytes: 0,
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    bodyFetched: false,
    inReplyTo: null,
    references: null,
    threadId: null,
    awaitingReply: false,
    awaitingReplySince: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
  };
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

const EMB_DIM = 4;
const INPUT_DIM = EMB_DIM + FEATURE_NAMES.length;
const CONSTANT_VECTOR = [0.5, -0.5, 0.25, 0.1];

const anthropicNoConsent: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  dailyBudget: 100,
  dailyEmailLimit: 1000,
  autoClassify: true,
  confidenceThreshold: 0.85,
  reclassifyCooldownDays: 7,
  sendBodyExcerptsToCloud: false,
};

type StackOptions = {
  encoder?: Encoder;
  llm?: ReturnType<typeof createLlm>;
  llmConfig?: LLMConfig;
  settings?: Partial<System1Settings>;
  /** What the audit coin flip returns: 0 always audits, 0.99 never does (auditRate is 0.05). */
  rng?: number;
};

function createStack(opts: StackOptions = {}) {
  const heads = createSystem1HeadRepo(getDb);
  const signals = createSignalRepo(getDb);
  const embeddingRepo = createEmbeddingRepo(getDb());
  const encoder = opts.encoder ?? createEncoder(() => CONSTANT_VECTOR);
  const llm = opts.llm ?? createLlm();
  const llmConfig: LLMConfig = { ...(opts.llmConfig ?? anthropicNoConsent) };
  const settings: System1Settings = { ...DEFAULT_SYSTEM1_SETTINGS, ...opts.settings };
  const config = { getSystem1Settings: () => settings } as unknown as ConfigStore;
  const rng = { value: opts.rng ?? 0.99 };
  const log = vi.fn();

  const classifier = composeTriageClassifier({
    llmClient: { complete: llm.complete },
    vectorSearch: createVectorSearch(encoder, embeddingRepo),
    signals,
    getLLMConfig: () => llmConfig,
    system1: {
      heads,
      embeddingService: encoder,
      embeddingRepo,
      accounts: createAccountRepo(),
      priorRepliesToSender: createPriorRepliesCounter(getDb),
      recordAudit: recordSystem1Audit({ system1Heads: heads, config }),
      getSettings: () => settings,
      rng: () => rng.value,
      log,
    },
  });

  return {
    classifier,
    heads,
    signals,
    embeddingRepo,
    encoder,
    llm,
    llmConfig,
    settings,
    config,
    rng,
    log,
  };
}

type Stack = ReturnType<typeof createStack>;

/** Bias-only head: it gives the same answer for every input, so a test controls its confidence. */
function biasHead(
  questionId: string,
  kind: 'choice' | 'noul' | 'score',
  labels: string[],
  hot: number,
  overrides: Partial<Omit<HeadRecord, 'version'>> = {},
): Omit<HeadRecord, 'version'> {
  return {
    questionId,
    embeddingModel: MODEL,
    weights: {
      questionId,
      kind,
      labels,
      inputDim: INPUT_DIM,
      W: labels.map(() => new Array<number>(INPUT_DIM).fill(0)),
      b: labels.map((_, i) => (i === hot ? 12 : 0)),
      featureNames: [...FEATURE_NAMES],
    },
    threshold: 0.5,
    armed: true,
    metrics: {
      trainSize: 600,
      holdoutSize: 150,
      holdoutAgreement: 0.98,
      coverage: 0.8,
      disagreementUpperBound: 0.04,
      auditCount: 0,
      auditAgreement: null,
    },
    trainedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Seed the three heads: Planning / needs a reply / importance 3. `armed` and
 * `model` apply to every head; `only` lets a test arm just some of them.
 */
async function seedHeads(
  stack: Stack,
  o: { armed?: boolean; model?: string; unarmed?: string[]; threshold?: number } = {},
): Promise<void> {
  const common = (id: string): Partial<Omit<HeadRecord, 'version'>> => ({
    armed: o.armed !== false && !(o.unarmed ?? []).includes(id),
    embeddingModel: o.model ?? MODEL,
    ...(o.threshold !== undefined ? { threshold: o.threshold } : {}),
  });
  const folderIdx = TRIAGE_FOLDERS.indexOf('Planning');
  await stack.heads.save(
    biasHead('folder', 'choice', [...TRIAGE_FOLDERS], folderIdx, common('folder')),
  );
  await stack.heads.save(
    biasHead('needsReply', 'noul', ['false', 'true'], 1, common('needsReply')),
  );
  await stack.heads.save(
    biasHead('importance', 'score', ['1', '2', '3', '4'], 2, common('importance')),
  );
}

const classify = (
  stack: Stack,
  email: Email,
  classifyOpts?: { bodyPreview?: string; forceSystem2?: boolean },
): Promise<TriageClassificationResult> => stack.classifier.classify(email, hint, [], classifyOpts);

beforeEach(() => {
  uid = 0;
  initDb(':memory:', SCHEMA_PATH);
  seedAccount();
});

afterEach(() => {
  vi.useRealTimers();
  closeDb();
});

// ---------------------------------------------------------------------------
// Who answers
// ---------------------------------------------------------------------------

describe('System 1 in the triage stack: who answers', () => {
  it('armed and confident heads answer on-device: the LLM is not called and a system1 signal is recorded', async () => {
    const stack = createStack();
    await seedHeads(stack);
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(result.source).toBe('system1');
    expect(result.folder).toBe('Planning');
    expect(result.importance).toBe(3);
    expect(result.needsReply).toBeGreaterThan(0.9);
    expect(stack.llm.complete).not.toHaveBeenCalled();

    // Signal recording is outermost, so the on-device answer is recorded too.
    const signal = await stack.signals.get(email.id, 'system1');
    expect(signal).toMatchObject({
      source: 'system1',
      folder: 'Planning',
      importance: 3,
      modelVersion: SYSTEM1_VERSION,
    });
    expect(signal!.needsReply).toBeGreaterThan(0.9);
    expect(await stack.signals.get(email.id, 'system2')).toBeNull();
  });

  it('stores the vector the heads scored, keyed by the encoder id and without inventing a label', async () => {
    const stack = createStack();
    await seedHeads(stack);
    const email = insertEmail();

    await classify(stack, email);

    const stored = await stack.embeddingRepo.findByEmail(email.id, MODEL);
    expect(stored).not.toBeNull();
    expect(stored!.embedding.map((v) => Number(v.toFixed(4)))).toEqual(CONSTANT_VECTOR);
    expect(stored!.folder).toBe('');
  });

  it('unarmed heads: the LLM answers and a system2 signal is recorded', async () => {
    const stack = createStack();
    await seedHeads(stack, { armed: false });
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(result.source).toBe('llm');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
    expect(await stack.signals.get(email.id, 'system1')).toBeNull();
    expect(await stack.signals.get(email.id, 'system2')).toMatchObject({
      source: 'system2',
      folder: 'Planning',
      modelVersion: 'claude-haiku-4-5',
    });
  });

  it('no heads trained yet: the LLM answers, and the vector is still stored for training', async () => {
    const stack = createStack();
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(result.source).toBe('llm');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
    expect(await stack.embeddingRepo.findByEmail(email.id, MODEL)).not.toBeNull();
  });

  it('one unarmed head is enough to send the whole email to the LLM', async () => {
    const stack = createStack();
    await seedHeads(stack, { unarmed: ['importance'] });

    const result = await classify(stack, insertEmail());

    expect(result.source).toBe('llm');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
  });

  it('a head that is not confident enough escalates', async () => {
    const stack = createStack();
    await seedHeads(stack, { threshold: 1.01 });
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(result.source).toBe('llm');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
    expect(await stack.signals.get(email.id, 'system1')).toBeNull();
  });

  it('heads trained with another encoder never answer', async () => {
    const stack = createStack();
    await seedHeads(stack, { model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' });

    const result = await classify(stack, insertEmail());

    expect(result.source).toBe('llm');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
  });

  it('forceSystem2 (reclassify) reaches the LLM even when System 1 is armed and confident', async () => {
    const stack = createStack();
    await seedHeads(stack);
    const email = insertEmail();

    const result = await classify(stack, email, { forceSystem2: true });

    expect(result.source).toBe('llm');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
    expect(stack.encoder.calls).toHaveLength(0); // System 1 did not even embed
    expect(await stack.signals.get(email.id, 'system2')).not.toBeNull();
    expect(await stack.signals.get(email.id, 'system1')).toBeNull();
  });

  it('System 1 switched off: the LLM answers and nothing is embedded', async () => {
    const stack = createStack({ settings: { enabled: false } });
    await seedHeads(stack);

    const result = await classify(stack, insertEmail());

    expect(result.source).toBe('llm');
    expect(stack.encoder.calls).toHaveLength(0);
  });

  it('an encoder failure never fails the classification: the LLM answers', async () => {
    const encoder = createEncoder(() => CONSTANT_VECTOR);
    encoder.embed = async () => {
      throw new Error('model files missing');
    };
    const stack = createStack({ encoder });
    await seedHeads(stack);
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(result.source).toBe('llm');
    expect(await stack.signals.get(email.id, 'system2')).not.toBeNull();
  });

  it('legacy encoder id: the heads trained under the storage key still answer', async () => {
    // Xenova/all-MiniLM-L6-v2 is stored as 'all-MiniLM-L6-v2'. The settings name the
    // Hugging Face id; the service's getModel() is what training and storage use.
    const legacy = createEncoder(() => CONSTANT_VECTOR, 'all-MiniLM-L6-v2');
    const stack = createStack({
      encoder: legacy,
      settings: { embeddingModel: 'Xenova/all-MiniLM-L6-v2' },
    });
    await seedHeads(stack, { model: 'all-MiniLM-L6-v2' });
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(result.source).toBe('system1');
    expect(stack.llm.complete).not.toHaveBeenCalled();
    expect(await stack.embeddingRepo.findByEmail(email.id, 'all-MiniLM-L6-v2')).not.toBeNull();
    expect((await stack.signals.get(email.id, 'system1'))!.modelVersion).toBe(
      'system1:all-MiniLM-L6-v2',
    );
  });
});

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

describe('System 1 in the triage stack: audits', () => {
  it('an audited answer goes to the LLM, the LLM result is returned and the audit is recorded', async () => {
    const stack = createStack({ rng: 0 });
    await seedHeads(stack);
    const email = insertEmail();

    const result = await classify(stack, email);

    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('llm');
    expect(result.reasoning).toBe('teacher');
    // The teacher wins: recorded as system2, nothing recorded for System 1.
    expect(await stack.signals.get(email.id, 'system2')).not.toBeNull();
    expect(await stack.signals.get(email.id, 'system1')).toBeNull();

    for (const id of Object.values(EMAIL_QUESTIONS).map((q) => q.id)) {
      const head = await stack.heads.getLatest(id);
      expect(head!.metrics.auditCount).toBe(1);
      expect(head!.metrics.auditAgreement).toBe(1);
    }
  });

  it('audits where the teacher disagrees are counted against the head', async () => {
    const llm = createLlm(() => ({ ...TEACHER_AGREES, folder: 'Feed' }));
    const stack = createStack({ rng: 0, llm });
    await seedHeads(stack);

    await classify(stack, insertEmail());

    expect((await stack.heads.getLatest('folder'))!.metrics.auditAgreement).toBe(0);
    expect((await stack.heads.getLatest('needsReply'))!.metrics.auditAgreement).toBe(1);
  });

  it('drift disarms a head, and the very next email goes to the LLM', async () => {
    const llm = createLlm(() => ({ ...TEACHER_AGREES, folder: 'Feed' }));
    const stack = createStack({ rng: 0, llm });
    await seedHeads(stack);

    for (let i = 0; i < 20; i++) await classify(stack, insertEmail({ subject: `Question ${i} ?` }));

    expect((await stack.heads.getLatest('folder'))!.armed).toBe(false);
    expect((await stack.heads.getLatest('needsReply'))!.armed).toBe(true);

    // No more audit coin flips: only an unarmed head can still send this one to the LLM.
    stack.rng.value = 0.99;
    const calls = llm.complete.mock.calls.length;
    const result = await classify(stack, insertEmail({ subject: 'Une autre question ?' }));

    expect(result.source).toBe('llm');
    expect(llm.complete.mock.calls.length).toBe(calls + 1);
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe('System 1 in the triage stack: privacy invariant', () => {
  const BODY_TOKEN = 'ZX9-BODY-TOKEN-4417';
  const SNIPPET_TOKEN = 'QW3-SNIPPET-TOKEN-8820';
  const preview = `Bonjour, voici le code ${BODY_TOKEN} à ne pas diffuser.`;

  const mail = () => insertEmail({ snippet: `Aperçu ${SNIPPET_TOKEN}` });

  /** The text System 1 handed to the encoder (canonical system1Text starts with "From:"). */
  const system1Inputs = (stack: Stack) => stack.encoder.calls.filter((t) => t.startsWith('From:'));

  it('cloud provider, no consent: System 1 gets the body locally, the LLM prompt never does (LLM called)', async () => {
    const stack = createStack({
      llmConfig: { ...anthropicNoConsent, sendBodyExcerptsToCloud: false },
    });
    await seedHeads(stack, { armed: false }); // forces the LLM call

    await classify(stack, mail(), { bodyPreview: preview });

    expect(system1Inputs(stack).some((t) => t.includes(BODY_TOKEN))).toBe(true);
    expect(stack.llm.prompts).toHaveLength(1);
    expect(stack.llm.prompts[0]).not.toContain(BODY_TOKEN);
    expect(stack.llm.prompts[0]).not.toContain(SNIPPET_TOKEN);
  });

  it('cloud provider, no consent: also holds on the audit path', async () => {
    const stack = createStack({ rng: 0 });
    await seedHeads(stack);

    await classify(stack, mail(), { bodyPreview: preview });

    expect(system1Inputs(stack).some((t) => t.includes(BODY_TOKEN))).toBe(true);
    expect(stack.llm.prompts).toHaveLength(1);
    expect(stack.llm.prompts[0]).not.toContain(BODY_TOKEN);
    expect(stack.llm.prompts[0]).not.toContain(SNIPPET_TOKEN);
  });

  it('cloud provider, no consent: when System 1 answers, no prompt exists at all', async () => {
    const stack = createStack();
    await seedHeads(stack);

    const result = await classify(stack, mail(), { bodyPreview: preview });

    expect(result.source).toBe('system1');
    expect(system1Inputs(stack).some((t) => t.includes(BODY_TOKEN))).toBe(true);
    expect(stack.llm.prompts).toHaveLength(0);
  });

  it('control: a local provider (ollama) does get the body excerpt in the prompt', async () => {
    const stack = createStack({ llmConfig: { ...anthropicNoConsent, provider: 'ollama' } });
    await seedHeads(stack, { armed: false });

    await classify(stack, mail(), { bodyPreview: preview });

    expect(system1Inputs(stack).some((t) => t.includes(BODY_TOKEN))).toBe(true);
    expect(stack.llm.prompts[0]).toContain(BODY_TOKEN);
    expect(stack.llm.prompts[0]).toContain(SNIPPET_TOKEN);
  });

  it('control: a cloud provider with explicit consent gets the body excerpt too', async () => {
    const stack = createStack({
      llmConfig: { ...anthropicNoConsent, sendBodyExcerptsToCloud: true },
    });
    await seedHeads(stack, { armed: false });

    await classify(stack, mail(), { bodyPreview: preview });

    expect(stack.llm.prompts[0]).toContain(BODY_TOKEN);
  });

  it('revoking consent applies to the very next email', async () => {
    const stack = createStack({
      llmConfig: { ...anthropicNoConsent, sendBodyExcerptsToCloud: true },
    });
    await seedHeads(stack, { armed: false });

    await classify(stack, mail(), { bodyPreview: preview });
    stack.llmConfig.sendBodyExcerptsToCloud = false;
    await classify(stack, mail(), { bodyPreview: preview });

    expect(stack.llm.prompts[0]).toContain(BODY_TOKEN);
    expect(stack.llm.prompts[1]).not.toContain(BODY_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// The whole loop: the LLM teaches, System 1 takes over
// ---------------------------------------------------------------------------

describe('System 1 in the triage stack: learning from the LLM', () => {
  type Topic = {
    keyword: string;
    folder: string;
    needsReply: boolean;
    importance: number;
    subject: (n: number) => string;
    from: (n: number) => string;
  };
  const TOPICS: Topic[] = [
    {
      keyword: 'devis',
      folder: 'Planning',
      needsReply: true,
      importance: 4,
      subject: (n) => `Pourriez-vous confirmer le devis n°${n} ?`,
      from: (n) => `client${n % 7}@atelier.fr`,
    },
    {
      keyword: 'lettre',
      folder: 'Feed',
      needsReply: false,
      importance: 2,
      subject: (n) => `La lettre de la semaine n°${n}`,
      from: () => 'lettre@journal.fr',
    },
    {
      keyword: 'promotion',
      folder: 'Promotions',
      needsReply: false,
      importance: 1,
      subject: (n) => `Promotion exceptionnelle -${n}%`,
      from: () => 'offres@boutique.fr',
    },
  ];

  const topicOf = (text: string): Topic => {
    const lower = text.toLowerCase();
    return TOPICS.find((t) => lower.includes(t.keyword)) ?? TOPICS[0]!;
  };

  /** Topic one-hot plus a little deterministic noise: separable, but not trivially so. */
  const vectorFor = (text: string): number[] => {
    const topic = TOPICS.indexOf(topicOf(text));
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const noise = (k: number) => (((Math.imul(h, k + 1) >>> 0) % 1000) / 1000 - 0.5) * 0.2;
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i < 3 ? (i === topic ? 1 : 0) : noise(i)));
  };

  const teacher = (prompt: string): LlmAnswer => {
    const subject = /^Subject: (.*)$/m.exec(prompt)?.[1] ?? '';
    const topic = topicOf(subject);
    return {
      folder: topic.folder,
      tags: [],
      confidence: 0.92,
      patternAgreed: true,
      needsReply: topic.needsReply,
      importance: topic.importance,
      reasoning: 'teacher',
    };
  };

  it('LLM answers become labels, the heads arm, and System 1 then answers instead of the LLM', async () => {
    // Only the clock is faked: the decorator reuses the heads it loaded for up to 60 s.
    vi.useFakeTimers({ toFake: ['Date'] });
    const encoder = createEncoder(vectorFor);
    const llm = createLlm(teacher);
    const stack = createStack({ encoder, llm });
    const base = new Date('2026-06-01T08:00:00.000Z').getTime();

    // Cold start: nothing is trained, so every email is answered by the LLM (the teacher).
    const PER_TOPIC = 240;
    for (let n = 0; n < PER_TOPIC * TOPICS.length; n++) {
      const topic = TOPICS[n % TOPICS.length]!;
      const result = await classify(
        stack,
        insertEmail({
          subject: topic.subject(n),
          from: topic.from(n),
          date: new Date(base + n * 60_000),
        }),
      );
      expect(result.source).toBe('llm');
    }
    expect(llm.complete).toHaveBeenCalledTimes(PER_TOPIC * TOPICS.length);

    // Training uses the stored vectors and the recorded system2 signals; nothing else.
    const status = await trainSystem1({
      system1Heads: stack.heads,
      system1Training: createSystem1TrainingRepo(getDb),
      embeddingService: encoder,
      config: stack.config,
    })();
    expect(status.embeddingModel).toBe(MODEL);
    expect(status.heads.map((h) => [h.questionId, h.armed])).toEqual([
      ['folder', true],
      ['needsReply', true],
      ['importance', true],
    ]);

    // From now on System 1 answers these emails on-device (once the head cache has expired).
    vi.setSystemTime(Date.now() + 61_000);
    const callsBefore = llm.complete.mock.calls.length;
    for (const [i, topic] of TOPICS.entries()) {
      const n = 10_000 + i;
      const email = insertEmail({
        subject: topic.subject(n),
        from: topic.from(n),
        date: new Date(base + n * 60_000),
      });
      const result = await classify(stack, email);

      expect(result.source).toBe('system1');
      expect(result.folder).toBe(topic.folder);
      expect(result.importance).toBe(topic.importance);
      expect(result.needsReply! >= 0.5).toBe(topic.needsReply);
      expect(await stack.signals.get(email.id, 'system1')).toMatchObject({
        folder: topic.folder,
        modelVersion: SYSTEM1_VERSION,
      });
    }
    expect(llm.complete.mock.calls.length).toBe(callsBefore);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The model is only downloaded on request: until then System 1 is off
// ---------------------------------------------------------------------------

describe('System 1 in the triage stack: on-device model not installed', () => {
  /** The encoder of a fresh install: nothing was downloaded, so every embed() refuses. */
  function createMissingEncoder(): Encoder {
    const calls: string[] = [];
    return {
      calls,
      embed: async (text) => {
        calls.push(text);
        throw new EmbeddingModelNotInstalledError(MODEL);
      },
      similarity: (a, b) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0),
      getModel: () => MODEL,
      getDownloadState: () => ({ installed: false, downloading: false, error: null }),
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the LLM classifies the mail; nothing throws, nothing is logged, no vector is stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stack = createStack({ encoder: createMissingEncoder() });
    // Heads left over from an earlier install must not matter either.
    await seedHeads(stack);
    // A labelled neighbour exists, so the kNN path really tries to embed the query.
    await stack.embeddingRepo.save(
      insertEmail({ subject: 'Ancien devis' }).id,
      CONSTANT_VECTOR,
      'Planning',
      false,
      MODEL,
    );
    const email = insertEmail();

    const result = await classify(stack, email, { bodyPreview: 'Bonjour, la date ?' });

    expect(result.source).toBe('llm');
    expect(result.folder).toBe('Planning');
    expect(stack.llm.complete).toHaveBeenCalledTimes(1);
    expect(await stack.signals.get(email.id, 'system2')).toMatchObject({ source: 'system2' });
    expect(await stack.signals.get(email.id, 'system1')).toBeNull();
    expect(await stack.embeddingRepo.findByEmail(email.id, MODEL)).toBeNull();
    expect(stack.log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // System 1 and the kNN both asked, and both were refused without any fetch.
    expect(stack.encoder.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the cloud privacy rule: the body preview still never reaches the LLM', async () => {
    const stack = createStack({ encoder: createMissingEncoder() });
    const email = insertEmail();
    await classify(stack, email, { bodyPreview: 'SECRET-BODY-TEXT' });
    expect(stack.llm.prompts).toHaveLength(1);
    expect(stack.llm.prompts[0]).not.toContain('SECRET-BODY-TEXT');
  });

  it('classifies a whole batch without a single failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stack = createStack({ encoder: createMissingEncoder() });
    for (let n = 0; n < 5; n++) {
      const result = await classify(stack, insertEmail({ subject: `Mail ${n}` }));
      expect(result.source).toBe('llm');
    }
    expect(stack.llm.complete).toHaveBeenCalledTimes(5);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the nightly retrain never tries to embed', async () => {
    const encoder = createMissingEncoder();
    const stack = createStack({ encoder });
    const status = await trainSystem1({
      system1Heads: stack.heads,
      system1Training: createSystem1TrainingRepo(getDb),
      embeddingService: encoder,
      config: stack.config,
    })();

    expect(encoder.calls).toEqual([]);
    expect(status.modelInstalled).toBe(false);
    expect(status.modelDownloading).toBe(false);
    expect(status.heads.every((h) => !h.armed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Training and inference must agree on "prior replies to this sender"
// ---------------------------------------------------------------------------

describe('System 1 features: prior replies to the sender', () => {
  const PRIOR_REPLIES_INDEX = FEATURE_NAMES.findIndex((name) => /prior/i.test(name));

  /** Insert a mail from `from` in account `accountId` with an arbitrary recipient value and date. */
  function insertRaw(o: {
    accountId?: number;
    from: string;
    to: unknown;
    date: string;
    subject?: string;
  }): number {
    uid++;
    const accountId = o.accountId ?? 1;
    const folderId = accountId === 1 ? 2 : 3;
    const result = getDb()
      .prepare(
        `INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address,
                             to_addresses, date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `<raw${uid}@x>`,
        accountId,
        folderId,
        uid,
        o.subject ?? 'Re: sujet',
        o.from,
        typeof o.to === 'string' ? o.to : JSON.stringify(o.to),
        o.date,
      );
    return Number(result.lastInsertRowid);
  }

  /** The count a feature value encodes: priorReplies = min(1, log1p(n) / 3). */
  const countOf = (feature: number): number => Math.round(Math.expm1(feature * 3));

  async function trainingCounts(): Promise<Map<number, number>> {
    const samples = await createSystem1TrainingRepo(getDb).listSamples('needsReply', {
      embeddingModel: MODEL,
    });
    return new Map(
      samples.map((s) => [s.emailId, countOf(s.input.features[PRIOR_REPLIES_INDEX]!)]),
    );
  }

  beforeEach(() => {
    getDb().exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
                  VALUES ('B', 'other@test.com', 'imap.test.com', 'smtp.test.com', 'other')`);
    getDb().exec(`INSERT INTO folders (account_id, path, name) VALUES (2, 'INBOX', 'Inbox')`);
  });

  it('exposes the feature under a recognisable name', () => {
    expect(PRIOR_REPLIES_INDEX).toBeGreaterThanOrEqual(0);
  });

  it('counts the same mails at training time and at inference time (now = the email date)', async () => {
    const marie = 'marie@atelier.be';
    const T = (day: number, hour = 10) => new Date(Date.UTC(2026, 5, day, hour)).toISOString();

    // Mail I sent to Marie before the mail in question (all of these count).
    insertRaw({ from: 'me@test.com', to: [marie], date: T(1) });
    insertRaw({ from: 'ME@Test.com', to: ['Marie@Atelier.BE'], date: T(2) }); // case-insensitive
    insertRaw({ from: 'me@test.com', to: [{ address: marie, name: 'Marie' }], date: T(3) });
    insertRaw({ from: 'me@test.com', to: ['paul@x.be', marie, marie], date: T(4) }); // once per mail
    insertRaw({ from: 'me@test.com', to: [` ${marie} `], date: T(5) }); // padded address

    // Things that must never count.
    insertRaw({
      from: 'me@test.com',
      to: ['marie.dupont@atelier.be', 'xmarie@atelier.be'],
      date: T(6),
    });
    insertRaw({ from: marie, to: ['me@test.com'], date: T(1) }); // received, not sent
    insertRaw({ accountId: 2, from: 'other@test.com', to: [marie], date: T(1) }); // other account
    insertRaw({ from: 'me@test.com', to: [marie], date: 'not a date' }); // unusable date

    // The mail in question (day 10, 10:00), a sent mail at the same instant, and later replies.
    const received = insertRaw({ from: marie, to: ['me@test.com'], date: T(10) });
    insertRaw({ from: 'me@test.com', to: [marie], date: T(10) }); // same instant: not "before"
    insertRaw({ from: 'me@test.com', to: [marie], date: T(11) }); // my reply to it: the leak

    // A second received mail, later: sees one more of my earlier mails (day 10 and 11 count).
    const later = insertRaw({ from: marie, to: ['me@test.com'], date: T(20) });

    // Both received mails become training samples (a stored vector and a System 2 label).
    for (const id of [received, later]) {
      getDb()
        .prepare(
          `INSERT INTO email_embeddings (email_id, embedding, embedding_model, folder) VALUES (?, ?, ?, '')`,
        )
        .run(id, Buffer.from(new Float32Array([1, 0, 0]).buffer), MODEL);
      getDb()
        .prepare(
          `INSERT INTO email_signals (email_id, source, needs_reply) VALUES (?, 'system2', 1)`,
        )
        .run(id);
    }
    const training = await trainingCounts();
    const counter = createPriorRepliesCounter(getDb);

    for (const id of [received, later]) {
      const row = getDb().prepare('SELECT date FROM emails WHERE id = ?').get(id) as {
        date: string;
      };
      const inference = await counter(1, marie, new Date(row.date));
      expect(inference).toBe(training.get(id));
    }
    expect(training.get(received)).toBe(5);
    expect(training.get(later)).toBe(7); // + the same-instant mail and my reply to the first one
  });

  it('without a reference time the inference counter counts everything sent so far', async () => {
    insertRaw({ from: 'me@test.com', to: ['marie@atelier.be'], date: '2026-06-01T10:00:00.000Z' });
    insertRaw({ from: 'me@test.com', to: ['marie@atelier.be'], date: '2026-06-20T10:00:00.000Z' });
    const counter = createPriorRepliesCounter(getDb);

    expect(await counter(1, 'marie@atelier.be')).toBe(2);
    expect(await counter(1, 'marie@atelier.be', new Date('2026-06-10T00:00:00.000Z'))).toBe(1);
  });
});
