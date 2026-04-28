import { describe, it, expect, vi } from 'vitest';
import { loadOrCreateBodyKey } from './body-passphrase';
import { encryptBody, decryptBody } from './body-cipher';
import type { SecureStorage } from '../../core/ports';

function mkSecrets(initial?: string): { secrets: SecureStorage; store: Map<string, string> } {
  const store = new Map<string, string>();
  if (initial) store.set('pluribus:body-cipher', initial);
  const secrets: SecureStorage = {
    setPassword: vi.fn(async () => {}),
    getPassword: vi.fn(async () => null),
    deletePassword: vi.fn(async () => false),
    setApiKey: vi.fn(async (service: string, key: string) => {
      store.set(service, key);
    }),
    getApiKey: vi.fn(async (service: string) => store.get(service) ?? null),
    clearSession: vi.fn(),
    getConfig: vi.fn(() => ({ biometricMode: 'never', sessionTimeoutMs: 0, requireForSend: false })),
    setConfig: vi.fn(),
    isBiometricAvailable: vi.fn(async () => false),
  };
  return { secrets, store };
}

describe('loadOrCreateBodyKey', () => {
  it('generates + persists a passphrase on first run', async () => {
    const { secrets, store } = mkSecrets();
    const key = await loadOrCreateBodyKey(secrets);
    expect(key.length).toBe(32);
    expect(store.get('pluribus:body-cipher')).toBeTruthy();
    expect(secrets.setApiKey).toHaveBeenCalledTimes(1);
  });

  it('reuses the stored passphrase on subsequent runs (stable key)', async () => {
    const { secrets } = mkSecrets();
    const first = await loadOrCreateBodyKey(secrets);
    vi.clearAllMocks();
    const second = await loadOrCreateBodyKey(secrets);
    expect(Buffer.compare(first, second)).toBe(0);
    expect(secrets.setApiKey).not.toHaveBeenCalled();
  });

  it('produces keys that round-trip with body-cipher', async () => {
    const { secrets } = mkSecrets();
    const key = await loadOrCreateBodyKey(secrets);
    const plaintext = 'hello, invoice body';
    const encrypted = encryptBody(plaintext, key);
    expect(decryptBody(encrypted, key)).toBe(plaintext);
  });
});
