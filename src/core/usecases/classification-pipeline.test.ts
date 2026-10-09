/**
 * Triage pipeline guards (classifyNewEmails / triageAndMoveEmail):
 * - mail the user wrote, and mail in Sent/Drafts/Trash/Junk/Spam, is never triaged or moved;
 * - body previews are fetched best-effort for human mail, only when privacy settings allow;
 * - the triage log records which classifier answered.
 */

import { describe, it, expect, vi } from 'vitest';
import { classifyNewEmails } from './classification-usecases';
import { isUntriagedFolderPath, triageAndMoveEmail } from './triage-usecases';
import type { Account, Email, Folder, TriageClassificationResult } from '../domain';
import type { LLMConfig } from '../ports';

const ME = 'me@test.com';

function makeEmail(id: number, overrides: Partial<Email> = {}): Email {
  return {
    id,
    messageId: `<m${id}@x.com>`,
    accountId: 1,
    folderId: 1,
    uid: id,
    subject: `Subject ${id}`,
    from: { address: 'alice@example.com', name: 'Alice' },
    to: [ME],
    date: new Date(Date.UTC(2026, 5, 10, 12, 0, 0) - id * 60_000),
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

const account: Account = {
  id: 1,
  name: 'Test',
  email: ME,
  imapHost: 'imap.test.com',
  imapPort: 993,
  smtpHost: 'smtp.test.com',
  smtpPort: 587,
  username: 'me',
  isActive: true,
  lastSync: null,
};

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

type Setup = {
  emails: Email[];
  /** folder id -> path */
  folders?: Record<number, string>;
  config?: Partial<LLMConfig>;
  budget?: { used: number; limit: number };
  cachedBodies?: Record<number, { text: string; html: string }>;
  fetchBody?: (emailId: number) => Promise<{ text: string; html: string }>;
  result?: Partial<TriageClassificationResult>;
  /** Remove `source` from the classifier result (old classifiers did not set it). */
  dropSource?: boolean;
};

function setup(s: Setup) {
  const folderPaths = s.folders ?? { 1: 'INBOX', 2: 'Sent' };
  const budget = s.budget ?? { used: 0, limit: 0 };
  const result: TriageClassificationResult = {
    folder: 'Planning',
    tags: [],
    confidence: 0.9,
    patternAgreed: true,
    reasoning: 'ok',
    source: 'llm',
    ...s.result,
  };
  if (s.dropSource) delete result.source;

  const classify = vi.fn(async (_e: Email, _h: unknown, _x: unknown, _o?: unknown) => result);
  const moveMessage = vi.fn(async () => {});
  const log = vi.fn(async () => {});
  const setState = vi.fn(async () => {});
  const getBody = vi.fn(async (id: number) => s.cachedBodies?.[id] ?? null);
  const saveBody = vi.fn(async () => {});
  const fetchBody = vi.fn(s.fetchBody ?? (async () => ({ text: 'remote body text', html: '' })));

  const deps = {
    emails: {
      findById: vi.fn(async (id: number) => s.emails.find((e) => e.id === id) ?? null),
      setFolderId: vi.fn(async () => {}),
      getBody,
      saveBody,
    },
    classifier: {
      getEmailBudget: vi.fn(() => ({
        ...budget,
        allowed: budget.limit === 0 || budget.used < budget.limit,
      })),
    },
    classificationState: { setState },
    accounts: { findById: vi.fn(async () => account) },
    folders: {
      findById: vi.fn(async (id: number) =>
        folderPaths[id] === undefined
          ? null
          : ({ id, accountId: 1, path: folderPaths[id], name: folderPaths[id] } as Folder),
      ),
      getOrCreate: vi.fn(async (_a: number, path: string) => ({
        id: 99,
        accountId: 1,
        path,
        name: path,
      })),
    },
    patternMatcher: { match: vi.fn(() => ({ folder: 'INBOX', confidence: 0.5, tags: [] })) },
    triageClassifier: { classify },
    trainingRepo: { getRelevantExamples: vi.fn(async () => []) },
    triageLog: { log },
    imapFolderOps: { moveMessage },
    config: { getLLMConfig: () => llmConfig(s.config) },
    sync: { fetchBody },
  };
  return {
    deps: deps as never,
    raw: deps,
    classify,
    moveMessage,
    log,
    setState,
    getBody,
    fetchBody,
    saveBody,
  };
}

describe('classifyNewEmails - never triage mail the user wrote', () => {
  it('skips mail from the account address (any case) and does not move it', async () => {
    const t = setup({
      emails: [
        makeEmail(1, { from: { address: ME, name: null } }),
        makeEmail(2, { from: { address: 'ME@Test.COM', name: null } }),
        makeEmail(3),
      ],
    });
    const result = await classifyNewEmails(t.deps)([1, 2, 3]);

    expect(result).toEqual({ classified: 1, skipped: 2, triaged: 1 });
    expect(t.classify.mock.calls.map(([e]) => e.id)).toEqual([3]);
    expect(t.moveMessage).toHaveBeenCalledTimes(1);
    expect(t.moveMessage).toHaveBeenCalledWith(account, 3, 'INBOX', 'Planning');
    expect(t.log).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Sent',
    'Sent Items',
    'Sent Messages',
    '[Gmail]/Sent Mail',
    'INBOX.Sent',
    'Drafts',
    '[Gmail]/Drafts',
    'Trash',
    '[Gmail]/Trash',
    '[Gmail]/Bin',
    'Deleted Items',
    'Junk',
    'Junk E-mail',
    'Spam',
    '[Gmail]/Spam',
    'Éléments envoyés',
    'Brouillons',
    'Corbeille',
    'Courrier indésirable',
  ])('skips mail that lives in %s', async (folderPath) => {
    const t = setup({
      emails: [makeEmail(1, { folderId: 5 })],
      folders: { 1: 'INBOX', 5: folderPath },
    });
    const result = await classifyNewEmails(t.deps)([1]);
    expect(result).toEqual({ classified: 0, skipped: 1, triaged: 0 });
    expect(t.classify).not.toHaveBeenCalled();
    expect(t.moveMessage).not.toHaveBeenCalled();
    expect(t.log).not.toHaveBeenCalled();
    expect(t.setState).not.toHaveBeenCalled();
  });

  it.each([
    'INBOX',
    'Planning',
    'Review',
    'Archive',
    'Feed',
    'Paper-Trail/Admin',
    'Presented',
    'Spamassassin',
  ])('still triages mail in %s', async (folderPath) => {
    const t = setup({
      emails: [makeEmail(1, { folderId: 5 })],
      folders: { 5: folderPath },
      result: { folder: 'Feed' },
    });
    const result = await classifyNewEmails(t.deps)([1]);
    expect(result.classified).toBe(1);
    expect(t.classify).toHaveBeenCalledTimes(1);
  });

  it('does not let skipped mail use up the daily budget', async () => {
    const t = setup({
      emails: [
        makeEmail(1, { from: { address: ME, name: null } }),
        makeEmail(2, { folderId: 2 }),
        makeEmail(3),
      ],
      budget: { used: 0, limit: 1 },
    });
    // The newest email (id 1) is the user's own; budget for one must go to email 3.
    const result = await classifyNewEmails(t.deps)([1, 2, 3]);
    expect(t.classify.mock.calls.map(([e]) => e.id)).toEqual([3]);
    expect(result.classified).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('still processes everything when the folder or account cannot be resolved', async () => {
    const t = setup({ emails: [makeEmail(1, { folderId: 42 })], folders: {} });
    const result = await classifyNewEmails(t.deps)([1]);
    expect(result.classified).toBe(0); // triageAndMoveEmail throws "Folder not found" at move time
    expect(t.classify).toHaveBeenCalledTimes(1);
  });
});

describe('classifyNewEmails - body previews', () => {
  const body = { text: 'Hi,\n> old quote\nCould you confirm Friday?\n-- \nAlice', html: '' };

  it('passes a preview of the cached body for human mail under ollama', async () => {
    const t = setup({
      emails: [makeEmail(1)],
      config: { provider: 'ollama' },
      cachedBodies: { 1: body },
    });
    await classifyNewEmails(t.deps)([1]);
    expect(t.classify.mock.calls[0]![3]).toEqual({ bodyPreview: 'Hi,\nCould you confirm Friday?' });
    expect(t.fetchBody).not.toHaveBeenCalled();
  });

  it('fetches the body over IMAP (and caches it) when it is not cached', async () => {
    const t = setup({ emails: [makeEmail(1)], config: { provider: 'ollama' } });
    await classifyNewEmails(t.deps)([1]);
    expect(t.fetchBody).toHaveBeenCalledWith(account, 1);
    expect(t.saveBody).toHaveBeenCalledWith(1, { text: 'remote body text', html: '' });
    expect(t.classify.mock.calls[0]![3]).toEqual({ bodyPreview: 'remote body text' });
  });

  it('does not read or fetch any body under anthropic without the opt-in', async () => {
    const t = setup({
      emails: [makeEmail(1), makeEmail(2)],
      config: { provider: 'anthropic' },
      cachedBodies: { 1: body },
    });
    await classifyNewEmails(t.deps)([1, 2]);
    expect(t.getBody).not.toHaveBeenCalled();
    expect(t.fetchBody).not.toHaveBeenCalled();
    for (const call of t.classify.mock.calls) {
      expect(call).toHaveLength(3);
    }
  });

  it('passes a preview under anthropic when sendBodyExcerptsToCloud is on', async () => {
    const t = setup({
      emails: [makeEmail(1)],
      config: { provider: 'anthropic', sendBodyExcerptsToCloud: true },
      cachedBodies: { 1: body },
    });
    await classifyNewEmails(t.deps)([1]);
    expect(t.classify.mock.calls[0]![3]).toEqual({ bodyPreview: 'Hi,\nCould you confirm Friday?' });
  });

  it('does not fetch bodies for newsletters (List-Unsubscribe)', async () => {
    const t = setup({
      emails: [makeEmail(1, { listUnsubscribe: '<mailto:unsub@news.com>' })],
      config: { provider: 'ollama' },
    });
    await classifyNewEmails(t.deps)([1]);
    expect(t.getBody).not.toHaveBeenCalled();
    expect(t.fetchBody).not.toHaveBeenCalled();
    expect(t.classify.mock.calls[0]).toHaveLength(3);
  });

  it('classifies without a preview when the fetch fails', async () => {
    const t = setup({
      emails: [makeEmail(1)],
      config: { provider: 'ollama' },
      fetchBody: async () => {
        throw new Error('IMAP offline');
      },
    });
    const result = await classifyNewEmails(t.deps)([1]);
    expect(result.classified).toBe(1);
    expect(t.classify.mock.calls[0]).toHaveLength(3);
  });

  it('never has more than two body fetches in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const t = setup({
      emails: [1, 2, 3, 4, 5, 6].map((id) => makeEmail(id)),
      config: { provider: 'ollama' },
      fetchBody: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { text: 'body', html: '' };
      },
    });
    const result = await classifyNewEmails(t.deps)([1, 2, 3, 4, 5, 6]);
    expect(result.classified).toBe(6);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
    expect(t.fetchBody).toHaveBeenCalledTimes(6);
  });

  it('does not fetch bodies for mail it is going to skip', async () => {
    const t = setup({
      emails: [makeEmail(1, { from: { address: ME, name: null } })],
      config: { provider: 'ollama' },
    });
    await classifyNewEmails(t.deps)([1]);
    expect(t.getBody).not.toHaveBeenCalled();
    expect(t.fetchBody).not.toHaveBeenCalled();
  });
});

describe('triageAndMoveEmail', () => {
  it('forwards the preview to the classifier', async () => {
    const t = setup({ emails: [makeEmail(1)] });
    await triageAndMoveEmail(t.deps)(1, { bodyPreview: 'Hello?' });
    expect(t.classify.mock.calls[0]![3]).toEqual({ bodyPreview: 'Hello?' });
  });

  it('calls the classifier with three arguments when there is no preview', async () => {
    const t = setup({ emails: [makeEmail(1)] });
    await triageAndMoveEmail(t.deps)(1);
    expect(t.classify.mock.calls[0]).toHaveLength(3);
  });

  it("logs source 'system1' when System 1 answered, 'llm' otherwise", async () => {
    const s1 = setup({ emails: [makeEmail(1)], result: { source: 'system1' } });
    await triageAndMoveEmail(s1.deps)(1);
    expect(s1.log).toHaveBeenCalledWith(expect.objectContaining({ source: 'system1' }));

    const llm = setup({ emails: [makeEmail(1)], result: { source: 'llm' } });
    await triageAndMoveEmail(llm.deps)(1);
    expect(llm.log).toHaveBeenCalledWith(expect.objectContaining({ source: 'llm' }));

    const none = setup({ emails: [makeEmail(1)], dropSource: true });
    await triageAndMoveEmail(none.deps)(1);
    expect(none.log).toHaveBeenCalledWith(expect.objectContaining({ source: 'llm' }));

    const fallback = setup({ emails: [makeEmail(1)], result: { source: 'fallback' } });
    await triageAndMoveEmail(fallback.deps)(1);
    expect(fallback.log).toHaveBeenCalledWith(expect.objectContaining({ source: 'llm' }));
  });

  it("does not classify, log or move the account owner's own mail", async () => {
    const t = setup({ emails: [makeEmail(1, { from: { address: 'Me@Test.com', name: null } })] });
    const result = await triageAndMoveEmail(t.deps)(1);
    expect(t.classify).not.toHaveBeenCalled();
    expect(t.log).not.toHaveBeenCalled();
    expect(t.moveMessage).not.toHaveBeenCalled();
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('fallback');
  });

  it('does not classify, log or move mail in the Sent folder', async () => {
    const t = setup({ emails: [makeEmail(1, { folderId: 2 })] });
    await triageAndMoveEmail(t.deps)(1);
    expect(t.classify).not.toHaveBeenCalled();
    expect(t.moveMessage).not.toHaveBeenCalled();
  });
});

describe('isUntriagedFolderPath', () => {
  it('recognises special folders in English and French, ignoring case and accents', () => {
    for (const p of ['SENT', 'sent items', 'ÉLÉMENTS ENVOYÉS', 'courrier indésirable', 'DRAFTS']) {
      expect(isUntriagedFolderPath(p)).toBe(true);
    }
  });

  it('leaves triage and ordinary folders alone', () => {
    for (const p of [
      'INBOX',
      'Planning',
      'Review',
      'Archive',
      'Social',
      'Promotions',
      'Paper-Trail/Travel',
      'Absent',
    ]) {
      expect(isUntriagedFolderPath(p)).toBe(false);
    }
  });
});
