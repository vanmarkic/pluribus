import { describe, it, expect, vi } from 'vitest';
import { wrapEmailRepoWithEncryption } from './email-repo-encryption';
import { deriveContentKey, isEncrypted } from '../keychain/body-cipher';
import type { EmailRepo } from '../../core/ports';
import type { EmailBody } from '../../core/domain';

const KEY = deriveContentKey('passphrase');

function mkInnerRepo() {
  const store = new Map<number, EmailBody>();
  const inner: EmailRepo = {
    findById: vi.fn(async () => null),
    list: vi.fn(async () => []),
    search: vi.fn(async () => []),
    getBody: vi.fn(async (id: number) => store.get(id) ?? null),
    saveBody: vi.fn(async (id: number, body: EmailBody) => {
      store.set(id, body);
    }),
    insert: vi.fn(async () => ({}) as any),
    insertBatch: vi.fn(async () => ({ count: 0, ids: [] })),
    markRead: vi.fn(async () => {}),
    setStar: vi.fn(async () => {}),
    setFolderId: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  return { inner, store };
}

describe('wrapEmailRepoWithEncryption', () => {
  it('round-trips text and html through encryption', async () => {
    const { inner, store } = mkInnerRepo();
    const wrapped = wrapEmailRepoWithEncryption(inner, KEY);
    const body: EmailBody = { text: 'hello world', html: '<p>hello world</p>' };

    await wrapped.saveBody(1, body);

    // Underlying storage holds the ciphertext form with the v1: prefix.
    const stored = store.get(1)!;
    expect(isEncrypted(stored.text)).toBe(true);
    expect(isEncrypted(stored.html)).toBe(true);

    // Read path returns the original plaintext.
    const out = await wrapped.getBody(1);
    expect(out).toEqual(body);
  });

  it('never stores plaintext bodies when encryption is active', async () => {
    const { inner, store } = mkInnerRepo();
    const wrapped = wrapEmailRepoWithEncryption(inner, KEY);
    const secret = 'confidential invoice amount 1234.56';
    await wrapped.saveBody(2, { text: secret, html: `<p>${secret}</p>` });

    const stored = store.get(2)!;
    expect(stored.text).not.toContain(secret);
    expect(stored.html).not.toContain(secret);
    expect(stored.text).not.toContain('1234.56');
  });

  it('transparently reads legacy plaintext rows (no migration required)', async () => {
    const { inner, store } = mkInnerRepo();
    // Simulate a legacy row written before the decorator landed.
    store.set(3, { text: 'plain legacy text', html: '<p>legacy</p>' });

    const wrapped = wrapEmailRepoWithEncryption(inner, KEY);
    const out = await wrapped.getBody(3);
    expect(out).toEqual({ text: 'plain legacy text', html: '<p>legacy</p>' });
  });

  it('passes through empty text/html unchanged (no zero-length encryption envelope)', async () => {
    const { inner, store } = mkInnerRepo();
    const wrapped = wrapEmailRepoWithEncryption(inner, KEY);
    await wrapped.saveBody(4, { text: '', html: '' });
    expect(store.get(4)).toEqual({ text: '', html: '' });
    const out = await wrapped.getBody(4);
    expect(out).toEqual({ text: '', html: '' });
  });

  it('returns null when the inner repo has no body', async () => {
    const { inner } = mkInnerRepo();
    const wrapped = wrapEmailRepoWithEncryption(inner, KEY);
    expect(await wrapped.getBody(99)).toBeNull();
  });

  it('delegates all non-body methods to the inner repo unchanged', async () => {
    const { inner } = mkInnerRepo();
    const wrapped = wrapEmailRepoWithEncryption(inner, KEY);
    await wrapped.markRead(1, true);
    await wrapped.setStar(2, true);
    await wrapped.delete(3);
    expect(inner.markRead).toHaveBeenCalledWith(1, true);
    expect(inner.setStar).toHaveBeenCalledWith(2, true);
    expect(inner.delete).toHaveBeenCalledWith(3);
  });
});
