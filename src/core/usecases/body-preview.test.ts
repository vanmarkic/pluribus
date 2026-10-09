import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BODY_PREVIEW_CHARS,
  fetchBodyPreview,
  isHumanCandidate,
  makeBodyPreview,
  mayUseBodyPreview,
} from './body-preview';
import type { Account, Email } from '../domain';

describe('makeBodyPreview', () => {
  it('returns the text trimmed and whitespace-collapsed', () => {
    expect(
      makeBodyPreview({ text: '  Hello   there \r\n\r\n\r\n\r\nSecond  line ', html: '' }),
    ).toBe('Hello there\n\nSecond line');
  });

  it('drops quoted lines', () => {
    const text = 'Sounds good.\n> Can you send the file?\n>> older\nI will send it tomorrow.';
    expect(makeBodyPreview({ text, html: '' })).toBe('Sounds good.\nI will send it tomorrow.');
  });

  it('stops at the signature delimiter', () => {
    const text = 'Please call me.\n-- \nJohn Doe\nCEO, Example Corp';
    expect(makeBodyPreview({ text, html: '' })).toBe('Please call me.');
  });

  it('stops where a quoted earlier message is introduced (English and French)', () => {
    expect(
      makeBodyPreview({
        text: 'Yes, Friday works.\n\nOn Mon, 3 Jun 2026 at 10:00, Bob <b@x.com> wrote:\nOriginal text',
        html: '',
      }),
    ).toBe('Yes, Friday works.');
    expect(
      makeBodyPreview({
        text: 'Oui, vendredi me convient.\nLe lun. 3 juin 2026 à 10:00, Bob <b@x.com> a écrit :\nTexte',
        html: '',
      }),
    ).toBe('Oui, vendredi me convient.');
  });

  it('truncates to the maximum length', () => {
    const preview = makeBodyPreview({ text: 'a'.repeat(5000), html: '' });
    expect(preview).toHaveLength(BODY_PREVIEW_CHARS);
    expect(BODY_PREVIEW_CHARS).toBe(1000);
  });

  it('falls back to stripped HTML when there is no text part', () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><p>Bonjour&nbsp;Marie,</p><p>Pouvez-vous confirmer &amp; répondre ?</p><script>alert(1)</script></body></html>';
    expect(makeBodyPreview({ text: '', html })).toBe(
      'Bonjour Marie,\nPouvez-vous confirmer & répondre ?',
    );
  });

  it('returns an empty string for an empty body', () => {
    expect(makeBodyPreview({ text: '', html: '' })).toBe('');
  });
});

describe('mayUseBodyPreview', () => {
  it('allows local models and explicit cloud opt-in only', () => {
    expect(mayUseBodyPreview({ provider: 'ollama' })).toBe(true);
    expect(mayUseBodyPreview({ provider: 'anthropic' })).toBe(false);
    expect(mayUseBodyPreview({ provider: 'anthropic', sendBodyExcerptsToCloud: false })).toBe(
      false,
    );
    expect(mayUseBodyPreview({ provider: 'anthropic', sendBodyExcerptsToCloud: true })).toBe(true);
  });
});

describe('isHumanCandidate', () => {
  const base = {
    from: { address: 'alice@example.com', name: null },
    listUnsubscribe: null,
  } as Email;

  it('accepts ordinary received mail', () => {
    expect(isHumanCandidate(base, 'me@test.com')).toBe(true);
  });

  it('rejects mail with List-Unsubscribe', () => {
    expect(isHumanCandidate({ ...base, listUnsubscribe: '<mailto:u@x.com>' }, 'me@test.com')).toBe(
      false,
    );
  });

  it('rejects mail from the account itself, ignoring case', () => {
    expect(
      isHumanCandidate({ ...base, from: { address: 'ME@Test.com', name: null } }, 'me@test.com'),
    ).toBe(false);
  });
});

describe('fetchBodyPreview', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const email = { id: 7, accountId: 1 } as Email;
  const account = { id: 1 } as Account;

  function makeDeps(overrides: {
    cached?: { text: string; html: string } | null;
    fetchBody?: () => Promise<{ text: string; html: string }>;
  }) {
    const saveBody = vi.fn(async () => {});
    const fetchBody = vi.fn(overrides.fetchBody ?? (async () => ({ text: 'remote', html: '' })));
    return {
      saveBody,
      fetchBody,
      deps: {
        emails: {
          getBody: vi.fn(async () => overrides.cached ?? null),
          saveBody,
          findById: vi.fn(async () => email),
        } as never,
        accounts: { findById: vi.fn(async () => account) } as never,
        sync: { fetchBody } as never,
      },
    };
  }

  it('uses the cached body without touching IMAP', async () => {
    const { deps, fetchBody } = makeDeps({ cached: { text: 'cached text', html: '' } });
    expect(await fetchBodyPreview(deps)(7)).toBe('cached text');
    expect(fetchBody).not.toHaveBeenCalled();
  });

  it('fetches over IMAP and caches the body when nothing is cached', async () => {
    const { deps, fetchBody, saveBody } = makeDeps({});
    expect(await fetchBodyPreview(deps)(7)).toBe('remote');
    expect(fetchBody).toHaveBeenCalledWith(account, 7);
    expect(saveBody).toHaveBeenCalledWith(7, { text: 'remote', html: '' });
  });

  it('swallows fetch errors', async () => {
    const { deps } = makeDeps({
      fetchBody: async () => {
        throw new Error('boom');
      },
    });
    expect(await fetchBodyPreview(deps)(7)).toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps({ fetchBody: () => new Promise(() => {}) });
    const pending = fetchBodyPreview(deps)(7, 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toBeUndefined();
  });

  it('returns undefined for an empty body', async () => {
    const { deps } = makeDeps({ cached: { text: '', html: '' } });
    // An empty cached body object is still "cached"; the preview is empty.
    expect(await fetchBodyPreview(deps)(7)).toBeUndefined();
  });
});
