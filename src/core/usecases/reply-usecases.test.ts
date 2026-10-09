/**
 * findForgottenReplies / listForgottenReplies / backfillReplySignals
 * (the SQL itself is covered by adapters/db/reply-candidate-repo.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import { backfillReplySignals, findForgottenReplies, listForgottenReplies } from './reply-usecases';
import { DEFAULT_DIGEST_SETTINGS } from '../domain';
import type {
  Account,
  DigestSettings,
  Email,
  EmailSignal,
  ReplyCandidate,
  TriageClassificationResult,
} from '../domain';
import type { LLMConfig, PatternMatchResult, ReplyCandidateQuery } from '../ports';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const account: Account = {
  id: 1,
  name: 'Test',
  email: 'me@test.com',
  imapHost: 'imap.test.com',
  imapPort: 993,
  smtpHost: 'smtp.test.com',
  smtpPort: 587,
  username: 'me',
  isActive: true,
  lastSync: null,
};

function makeEmail(id: number, overrides: Partial<Email> = {}): Email {
  return {
    id,
    messageId: `<m${id}@x.com>`,
    accountId: 1,
    folderId: 1,
    uid: id,
    subject: `Subject ${id}`,
    from: { address: 'alice@example.com', name: 'Alice' },
    to: ['me@test.com'],
    date: new Date(NOW.getTime() - 3 * DAY - id * HOUR),
    snippet: '',
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
    ...overrides,
  };
}

function signal(emailId: number, overrides: Partial<EmailSignal> = {}): EmailSignal {
  return {
    emailId,
    source: 'system2',
    needsReply: 1,
    importance: 3,
    folder: 'INBOX',
    confidence: 0.9,
    modelVersion: 'claude-haiku-4-5',
    updatedAt: NOW,
    ...overrides,
  };
}

function candidate(
  id: number,
  sig: EmailSignal | null,
  emailOverrides: Partial<Email> = {},
): ReplyCandidate {
  return {
    email: makeEmail(id, emailOverrides),
    folderPath: 'INBOX',
    signal: sig,
    toIncludesMe: true,
  };
}

function makeQueryDeps(
  candidates: ReplyCandidate[],
  opts: { sent?: number; settings?: Partial<DigestSettings>; accounts?: Account[] } = {},
) {
  const settings: DigestSettings = { ...DEFAULT_DIGEST_SETTINGS, ...opts.settings };
  const all = opts.accounts ?? [account];
  const listUnanswered = vi.fn(async (_q: ReplyCandidateQuery) => candidates);
  const countSentByMe = vi.fn(async () => opts.sent ?? 5);
  return {
    listUnanswered,
    countSentByMe,
    deps: {
      replyCandidates: { listUnanswered, countSentByMe },
      accounts: {
        findById: vi.fn(async (id: number) => all.find((a) => a.id === id) ?? null),
        findAll: vi.fn(async () => all),
      } as never,
      digestConfig: { getSettings: () => settings, getState: vi.fn(), setState: vi.fn() },
    },
  };
}

describe('findForgottenReplies', () => {
  it('queries the lookback window minus grace in INBOX, Planning and Review', async () => {
    const { deps, listUnanswered, countSentByMe } = makeQueryDeps([]);
    await findForgottenReplies(deps)({ accountId: 1, now: NOW });

    const q = listUnanswered.mock.calls[0]![0];
    expect(q).toMatchObject({
      accountId: 1,
      myAddress: 'me@test.com',
      folders: ['INBOX', 'Planning', 'Review'],
      now: NOW,
    });
    expect(q.since.getTime()).toBe(NOW.getTime() - 14 * DAY);
    expect(q.until.getTime()).toBe(NOW.getTime() - DEFAULT_DIGEST_SETTINGS.graceHours * HOUR);
    expect(countSentByMe).toHaveBeenCalledWith(1, 'me@test.com', q.since);
  });

  it('waits 4 days by default before a mail counts as forgotten', () => {
    expect(DEFAULT_DIGEST_SETTINGS.graceHours).toBe(4 * 24);
    expect(DEFAULT_DIGEST_SETTINGS.minImportance).toBe(2);
  });

  it('lets opts.settings override the stored digest settings', async () => {
    const { deps, listUnanswered } = makeQueryDeps([]);
    await findForgottenReplies(deps)({
      accountId: 1,
      now: NOW,
      settings: { graceHours: 48, lookbackDays: 7 },
    });
    const q = listUnanswered.mock.calls[0]![0];
    expect(q.since.getTime()).toBe(NOW.getTime() - 7 * DAY);
    expect(q.until.getTime()).toBe(NOW.getTime() - 48 * HOUR);
  });

  it('returns the account address and generation time', async () => {
    const { deps } = makeQueryDeps([]);
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result).toEqual({
      accountId: 1,
      accountEmail: 'me@test.com',
      items: [],
      sentHealth: 'ok',
      generatedAt: NOW,
    });
  });

  it("suppresses items with sentHealth 'no-sent-mail' when nothing was sent", async () => {
    const { deps, listUnanswered } = makeQueryDeps([candidate(1, signal(1))], { sent: 0 });
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result.sentHealth).toBe('no-sent-mail');
    expect(result.items).toEqual([]);
    expect(listUnanswered).not.toHaveBeenCalled();
  });

  const mixedCandidates = () => [
    candidate(1, signal(1, { importance: 3 })),
    candidate(2, signal(2, { importance: 4 })),
    candidate(3, signal(3, { needsReply: 0.2 })),
    candidate(4, signal(4, { importance: 2 })),
    candidate(5, null, { subject: 'ok merci' }),
    candidate(6, signal(6, { importance: 1 })),
  ];

  it('gates, scores and sorts the candidates; normal mail is included by default, last', async () => {
    const { deps } = makeQueryDeps(mixedCandidates());
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result.items.map((i) => i.emailId)).toEqual([2, 1, 4]);
    expect(result.items[0]!.score).toBeGreaterThan(result.items[1]!.score);
    expect(result.items[1]!.score).toBeGreaterThan(result.items[2]!.score);
  });

  it.each([
    [2, [2, 1, 4]],
    [3, [2, 1]],
    [4, [2]],
  ] as const)('minImportance %i lists %j', async (minImportance, expected) => {
    const { deps } = makeQueryDeps(mixedCandidates(), { settings: { minImportance } });
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result.items.map((i) => i.emailId)).toEqual(expected);
  });

  it('includes heuristic items for mail without a signal', async () => {
    const { deps } = makeQueryDeps([
      candidate(1, null, { subject: 'Pouvez-vous m’envoyer le devis avant vendredi ?' }),
    ]);
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ basis: 'heuristic', signalSource: null });
  });

  it('caps the list at maxItems, keeping the best', async () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      candidate(i + 1, signal(i + 1, { importance: i === 5 ? 4 : 3 })),
    );
    const { deps } = makeQueryDeps(candidates, { settings: { maxItems: 3 } });
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result.items).toHaveLength(3);
    expect(result.items[0]!.emailId).toBe(6);
  });

  it('honours a maxItems override', async () => {
    const candidates = Array.from({ length: 6 }, (_, i) => candidate(i + 1, signal(i + 1)));
    const { deps } = makeQueryDeps(candidates, { settings: { maxItems: 10 } });
    const result = await findForgottenReplies(deps)({
      accountId: 1,
      now: NOW,
      settings: { maxItems: 2 },
    });
    expect(result.items).toHaveLength(2);
  });

  it('returns an empty result for an unknown account', async () => {
    const { deps, listUnanswered } = makeQueryDeps([], { accounts: [] });
    const result = await findForgottenReplies(deps)({ accountId: 9, now: NOW });
    expect(result).toMatchObject({ accountId: 9, accountEmail: '', items: [] });
    expect(listUnanswered).not.toHaveBeenCalled();
  });

  it('never puts the subject or addresses into the reason', async () => {
    const { deps } = makeQueryDeps([
      candidate(1, signal(1), { subject: 'Secret merger terms' }),
      candidate(2, null, { subject: 'Secret merger terms - can you reply?' }),
    ]);
    const result = await findForgottenReplies(deps)({ accountId: 1, now: NOW });
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.reason).not.toMatch(/secret|merger|alice/i);
    }
  });
});

describe('listForgottenReplies', () => {
  it('returns one result per active account', async () => {
    const inactive: Account = { ...account, id: 2, email: 'old@test.com', isActive: false };
    const second: Account = { ...account, id: 3, email: 'two@test.com' };
    const { deps, listUnanswered } = makeQueryDeps([], { accounts: [account, inactive, second] });
    const results = await listForgottenReplies(deps)({ now: NOW });
    expect(results.map((r) => r.accountId)).toEqual([1, 3]);
    expect(listUnanswered.mock.calls.map(([q]) => q.myAddress)).toEqual([
      'me@test.com',
      'two@test.com',
    ]);
  });
});

// ============================================
// backfillReplySignals
// ============================================

function llmConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
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

const classified: TriageClassificationResult = {
  folder: 'INBOX',
  tags: [],
  confidence: 0.9,
  patternAgreed: true,
  reasoning: 'ok',
  source: 'llm',
};

function makeBackfillDeps(
  candidates: ReplyCandidate[],
  opts: {
    config?: Partial<LLMConfig>;
    cachedBody?: { text: string; html: string } | null;
    classify?: (email: Email) => Promise<TriageClassificationResult>;
  } = {},
) {
  const classify = vi.fn(
    async (email: Email, _hint: unknown, _examples: unknown, _opts?: unknown) =>
      (opts.classify ?? (async () => classified))(email),
  );
  const listUnanswered = vi.fn(async (_q: ReplyCandidateQuery) => candidates);
  const getBody = vi.fn(async () => opts.cachedBody ?? null);
  const saveBody = vi.fn(async () => {});
  const fetchBody = vi.fn(async () => ({ text: 'fetched from imap', html: '' }));
  const hint: PatternMatchResult = { folder: 'INBOX', confidence: 0.5, tags: [] };
  return {
    classify,
    listUnanswered,
    getBody,
    saveBody,
    fetchBody,
    deps: {
      replyCandidates: { listUnanswered, countSentByMe: vi.fn(async () => 5) },
      accounts: { findById: vi.fn(async () => account) } as never,
      digestConfig: {
        getSettings: () => DEFAULT_DIGEST_SETTINGS,
        getState: vi.fn(),
        setState: vi.fn(),
      },
      emails: {
        getBody,
        saveBody,
        findById: vi.fn(
          async (id: number) => candidates.find((c) => c.email.id === id)?.email ?? null,
        ),
      } as never,
      sync: { fetchBody } as never,
      config: { getLLMConfig: () => llmConfig(opts.config) } as never,
      patternMatcher: { match: vi.fn(() => hint) },
      triageClassifier: { classify },
      trainingRepo: { getRelevantExamples: vi.fn(async () => []) } as never,
    },
  };
}

describe('backfillReplySignals', () => {
  it('classifies only candidates without a signal, newest first, and reports the counts', async () => {
    const { deps, classify } = makeBackfillDeps([
      candidate(1, null),
      candidate(2, signal(2)),
      candidate(3, null),
      candidate(4, signal(4)),
    ]);
    const result = await backfillReplySignals(deps)({ accountId: 1 });
    expect(result).toEqual({ processed: 2, skipped: 2 });
    expect(classify.mock.calls.map(([e]) => e.id)).toEqual([1, 3]);
  });

  it('uses the lookback window without the grace period', async () => {
    const { deps, listUnanswered } = makeBackfillDeps([]);
    const before = Date.now();
    await backfillReplySignals(deps)({ accountId: 1 });
    const q = listUnanswered.mock.calls[0]![0];
    expect(q.folders).toEqual(['INBOX', 'Planning', 'Review']);
    expect(q.until.getTime()).toBeGreaterThanOrEqual(before);
    expect(q.until.getTime() - q.since.getTime()).toBe(14 * DAY);
  });

  it('honours the limit (default 50)', async () => {
    const many = Array.from({ length: 70 }, (_, i) => candidate(i + 1, null));
    const first = makeBackfillDeps(many);
    expect(await backfillReplySignals(first.deps)({ accountId: 1 })).toEqual({
      processed: 50,
      skipped: 0,
    });
    const second = makeBackfillDeps(many);
    expect(await backfillReplySignals(second.deps)({ accountId: 1, limit: 5 })).toEqual({
      processed: 5,
      skipped: 0,
    });
    expect(second.classify).toHaveBeenCalledTimes(5);
  });

  it('stops at the first thrown error', async () => {
    const { deps, classify } = makeBackfillDeps(
      [candidate(1, null), candidate(2, null), candidate(3, null)],
      {
        classify: async (email) => {
          if (email.id === 2) throw new Error('LLM down');
          return classified;
        },
      },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await backfillReplySignals(deps)({ accountId: 1 });
    warn.mockRestore();
    expect(result).toEqual({ processed: 1, skipped: 0 });
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it('returns zeros for an unknown account', async () => {
    const { deps } = makeBackfillDeps([candidate(1, null)]);
    (deps.accounts as { findById: () => Promise<null> }).findById = async () => null;
    expect(await backfillReplySignals(deps)({ accountId: 9 })).toEqual({
      processed: 0,
      skipped: 0,
    });
  });

  it('does not touch the body under a cloud provider without opt-in', async () => {
    const { deps, classify, getBody, fetchBody } = makeBackfillDeps([candidate(1, null)], {
      cachedBody: { text: 'Hello, can you answer?', html: '' },
    });
    await backfillReplySignals(deps)({ accountId: 1 });
    expect(getBody).not.toHaveBeenCalled();
    expect(fetchBody).not.toHaveBeenCalled();
    expect(classify.mock.calls[0]).toHaveLength(3);
  });

  it('passes a body preview from the cached body under ollama', async () => {
    const { deps, classify, fetchBody } = makeBackfillDeps([candidate(1, null)], {
      config: { provider: 'ollama' },
      cachedBody: { text: 'Hello Bob,\n> quoted\nCan you answer by Friday?\n-- \nAlice', html: '' },
    });
    await backfillReplySignals(deps)({ accountId: 1 });
    expect(classify.mock.calls[0]![3]).toEqual({
      bodyPreview: 'Hello Bob,\nCan you answer by Friday?',
    });
    expect(fetchBody).not.toHaveBeenCalled();
  });

  it('fetches (and caches) the body when it is not cached yet', async () => {
    const { deps, classify, fetchBody, saveBody } = makeBackfillDeps([candidate(1, null)], {
      config: { provider: 'anthropic', sendBodyExcerptsToCloud: true },
    });
    await backfillReplySignals(deps)({ accountId: 1 });
    expect(fetchBody).toHaveBeenCalledTimes(1);
    expect(saveBody).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0]![3]).toEqual({ bodyPreview: 'fetched from imap' });
  });

  it('classifies without a preview when the body cannot be fetched', async () => {
    const { deps, classify, fetchBody } = makeBackfillDeps([candidate(1, null)], {
      config: { provider: 'ollama' },
    });
    fetchBody.mockRejectedValue(new Error('IMAP offline'));
    const result = await backfillReplySignals(deps)({ accountId: 1 });
    expect(result.processed).toBe(1);
    expect(classify.mock.calls[0]).toHaveLength(3);
  });

  it('skips the body for newsletters', async () => {
    const { deps, classify, getBody } = makeBackfillDeps(
      [candidate(1, null, { listUnsubscribe: '<mailto:u@x.com>' })],
      { config: { provider: 'ollama' } },
    );
    await backfillReplySignals(deps)({ accountId: 1 });
    expect(getBody).not.toHaveBeenCalled();
    expect(classify.mock.calls[0]).toHaveLength(3);
  });
});
