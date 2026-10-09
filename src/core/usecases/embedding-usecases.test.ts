import { describe, it, expect, vi } from 'vitest';
import {
  indexEmailForSearch,
  indexClassifiedBatch,
  backfillEmbeddings,
  getEmbeddingIndexStats,
} from './embedding-usecases';
import { system1Text } from '../system1/text';
import type { Email } from '../domain';

const mkEmail = (
  id: number,
  subject = 'Subject',
  snippet: string | null = 'Hello there',
  overrides: Partial<Email> = {},
): Email =>
  ({
    id,
    messageId: `m${id}`,
    accountId: 1,
    folderId: 1,
    uid: id,
    subject,
    from: { address: 's@x.com', name: 'Sender' },
    toAddresses: [],
    date: new Date(),
    snippet,
    sizeBytes: 0,
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    bodyFetched: false,
    ...overrides,
  }) as Email;

const mkDeps = (overrides: any = {}) => ({
  emails: {
    findById: async (id: number) => mkEmail(id),
    list: async () => [mkEmail(1), mkEmail(2), mkEmail(3)],
    getBody: vi.fn(async () => null),
  },
  vectorSearch: { indexEmail: vi.fn().mockResolvedValue(undefined) },
  embeddingRepo: {
    findByEmail: async () => null,
    count: async () => 0,
  },
  embeddingService: { getModel: () => 'Xenova/multilingual-e5-small' },
  classificationState: { getState: async () => null },
  backgroundTasks: {
    start: vi.fn((_id, _total, fn) => {
      void fn(() => {});
    }),
  },
  ...overrides,
});

describe('indexEmailForSearch', () => {
  it('embeds the canonical System 1 text (sender, subject), not subject+snippet', async () => {
    const deps = mkDeps();
    const ok = await indexEmailForSearch(deps as any)(1, 'Feed');
    expect(ok).toBe(true);
    const text = deps.vectorSearch.indexEmail.mock.calls[0]![1] as string;
    expect(text).toBe(system1Text(mkEmail(1)));
    expect(text).toContain('Subject: Subject');
    expect(text).toContain('<x.com>');
    expect(text).not.toContain('Hello there');
  });

  it('adds an excerpt of the CACHED body (never fetched over IMAP)', async () => {
    const deps = mkDeps({
      emails: {
        findById: async (id: number) => mkEmail(id, 'Devis rénovation'),
        getBody: vi.fn(async () => ({
          text: 'Bonjour,\n> ancien message\nPourriez-vous me confirmer le devis ?\n-- \nMarie',
          html: '',
        })),
      },
    });
    await indexEmailForSearch(deps as any)(1, 'Planning');
    const text = deps.vectorSearch.indexEmail.mock.calls[0]![1] as string;
    expect(text).toBe(
      system1Text(mkEmail(1, 'Devis rénovation'), 'Bonjour,\nPourriez-vous me confirmer le devis ?'),
    );
    expect(deps.emails.getBody).toHaveBeenCalledWith(1);
  });

  it('leaves the body out for newsletters, like the inference path does', async () => {
    const getBody = vi.fn(async () => ({ text: 'Lire la suite sur notre site', html: '' }));
    const deps = mkDeps({
      emails: {
        findById: async (id: number) =>
          mkEmail(id, 'Notre lettre', null, { listUnsubscribe: '<mailto:u@n.com>' }),
        getBody,
      },
    });
    await indexEmailForSearch(deps as any)(1, 'Feed');
    const text = deps.vectorSearch.indexEmail.mock.calls[0]![1] as string;
    expect(text).toBe(system1Text(mkEmail(1, 'Notre lettre')));
    expect(getBody).not.toHaveBeenCalled();
  });

  it('still indexes when the body cannot be read', async () => {
    const deps = mkDeps({
      emails: {
        findById: async (id: number) => mkEmail(id),
        getBody: vi.fn(async () => {
          throw new Error('db locked');
        }),
      },
    });
    expect(await indexEmailForSearch(deps as any)(1, 'Feed')).toBe(true);
  });

  it('keeps a vector the System 1 decorator already stored (keepVector)', async () => {
    const deps = mkDeps();
    await indexEmailForSearch(deps as any)(1, 'Feed');
    expect(deps.vectorSearch.indexEmail).toHaveBeenCalledWith(
      1,
      expect.any(String),
      'Feed',
      false,
      { keepVector: true },
    );
  });

  it('returns false when email is missing', async () => {
    const deps = mkDeps({ emails: { findById: async () => null, list: async () => [] } });
    expect(await indexEmailForSearch(deps as any)(99, 'INBOX')).toBe(false);
    expect(deps.vectorSearch.indexEmail).not.toHaveBeenCalled();
  });

  it('skips emails with nearly empty text', async () => {
    const deps = mkDeps({
      emails: { findById: async () => mkEmail(1, '', ''), getBody: async () => null },
    });
    expect(await indexEmailForSearch(deps as any)(1, 'INBOX')).toBe(false);
    expect(deps.vectorSearch.indexEmail).not.toHaveBeenCalled();
  });

  it('propagates the isCorrection flag', async () => {
    const deps = mkDeps();
    await indexEmailForSearch(deps as any)(1, 'Planning', true);
    expect(deps.vectorSearch.indexEmail).toHaveBeenCalledWith(
      1,
      expect.any(String),
      'Planning',
      true,
      { keepVector: true },
    );
  });
});

describe('indexClassifiedBatch', () => {
  it('counts successes and failures independently', async () => {
    const indexSpy = vi
      .fn()
      .mockResolvedValueOnce(undefined) // item 1 ok
      .mockRejectedValueOnce(new Error('boom')) // item 2 fail
      .mockResolvedValueOnce(undefined); // item 3 ok
    const deps = mkDeps({ vectorSearch: { indexEmail: indexSpy } });

    const result = await indexClassifiedBatch(deps as any)([
      { emailId: 1, folder: 'Feed' },
      { emailId: 2, folder: 'Feed' },
      { emailId: 3, folder: 'Feed' },
    ]);

    expect(result.indexed).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('returns {0,0} for empty input', async () => {
    const deps = mkDeps();
    const result = await indexClassifiedBatch(deps as any)([]);
    expect(result).toEqual({ indexed: 0, failed: 0 });
  });
});

describe('backfillEmbeddings', () => {
  it('enqueues only un-indexed emails and returns the correct total', async () => {
    const start = vi.fn((_id, _total, fn) => {
      void fn(() => {});
    });
    const deps = mkDeps({
      embeddingRepo: {
        findByEmail: async (id: number) =>
          id === 2
            ? {
                id: 1,
                emailId: 2,
                embedding: [],
                embeddingModel: 'x',
                folder: 'INBOX',
                isCorrection: false,
                createdAt: new Date(),
              }
            : null,
        count: async () => 1,
      },
      backgroundTasks: { start },
    });

    const result = await backfillEmbeddings(deps as any)({ limit: 100 });

    // Emails 1 and 3 are un-indexed; email 2 is skipped.
    expect(result.total).toBe(2);
    expect(start).toHaveBeenCalledWith(result.taskId, 2, expect.any(Function));
  });

  it("uses the state folder when available and never invents an 'INBOX' label", async () => {
    const indexSpy = vi.fn().mockResolvedValue(undefined);
    const deps = mkDeps({
      embeddingRepo: { findByEmail: async () => null, count: async () => 0 },
      classificationState: {
        getState: async (id: number) =>
          id === 1 ? { emailId: 1, suggestedFolder: 'Promotions', status: 'classified' } : null,
      },
      backgroundTasks: {
        start: async (_id: string, _total: number, fn: (cb: () => void) => Promise<void>) =>
          fn(() => {}),
      },
      vectorSearch: { indexEmail: indexSpy },
    });

    await backfillEmbeddings(deps as any)({ limit: 100 });

    // Flush the microtask queue so the background task completes.
    await new Promise((r) => setTimeout(r, 0));

    const opts = { keepVector: true };
    expect(indexSpy).toHaveBeenCalledWith(1, expect.any(String), 'Promotions', false, opts);
    // Unknown label: empty, not a made-up 'INBOX'.
    expect(indexSpy).toHaveBeenCalledWith(2, expect.any(String), '', false, opts);
    expect(indexSpy).toHaveBeenCalledWith(3, expect.any(String), '', false, opts);
    for (const call of indexSpy.mock.calls) expect(call[2]).not.toBe('INBOX');
  });

  it('embeds the canonical System 1 text from cached bodies only (no IMAP)', async () => {
    const indexSpy = vi.fn().mockResolvedValue(undefined);
    const fetchBody = vi.fn();
    const getBody = vi.fn(async (id: number) =>
      id === 1 ? { text: 'Merci de me confirmer la date.', html: '' } : null,
    );
    const deps = mkDeps({
      emails: {
        findById: async (id: number) => mkEmail(id),
        list: async () => [mkEmail(1, 'Réunion'), mkEmail(2, 'Facture')],
        getBody,
      },
      sync: { fetchBody },
      accounts: { findById: vi.fn() },
      backgroundTasks: {
        start: async (_id: string, _total: number, fn: (cb: () => void) => Promise<void>) =>
          fn(() => {}),
      },
      vectorSearch: { indexEmail: indexSpy },
    });

    await backfillEmbeddings(deps as any)({ limit: 100 });
    await new Promise((r) => setTimeout(r, 0));

    expect(indexSpy.mock.calls[0]![1]).toBe(
      system1Text(mkEmail(1, 'Réunion'), 'Merci de me confirmer la date.'),
    );
    expect(indexSpy.mock.calls[1]![1]).toBe(system1Text(mkEmail(2, 'Facture')));
    expect(getBody).toHaveBeenCalledTimes(2);
    expect(fetchBody).not.toHaveBeenCalled();
    expect(deps.accounts.findById).not.toHaveBeenCalled();
  });

  it('keeps going when one email fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const indexSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('model offline'))
      .mockResolvedValue(undefined);
    const progress = vi.fn();
    const deps = mkDeps({
      backgroundTasks: {
        start: async (_id: string, _total: number, fn: (cb: () => void) => Promise<void>) =>
          fn(progress),
      },
      vectorSearch: { indexEmail: indexSpy },
    });
    await backfillEmbeddings(deps as any)({ limit: 100 });
    await new Promise((r) => setTimeout(r, 0));
    expect(indexSpy).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe('getEmbeddingIndexStats', () => {
  it('returns coverage = indexed / total', async () => {
    const deps = mkDeps({
      embeddingRepo: { findByEmail: async () => null, count: async () => 2 },
    });
    const stats = await getEmbeddingIndexStats(deps as any)();
    expect(stats.totalEmails).toBe(3);
    expect(stats.indexed).toBe(2);
    expect(stats.coverage).toBeCloseTo(2 / 3, 5);
    expect(stats.model).toBe('Xenova/multilingual-e5-small');
  });

  it('returns coverage = 0 when the mailbox is empty', async () => {
    const deps = mkDeps({
      emails: { findById: async () => null, list: async () => [] },
      embeddingRepo: { findByEmail: async () => null, count: async () => 0 },
    });
    const stats = await getEmbeddingIndexStats(deps as any)();
    expect(stats.coverage).toBe(0);
  });

  it('caps coverage at 1.0 even if the counts disagree', async () => {
    const deps = mkDeps({
      embeddingRepo: { findByEmail: async () => null, count: async () => 999 },
    });
    const stats = await getEmbeddingIndexStats(deps as any)();
    expect(stats.coverage).toBe(1);
  });
});
