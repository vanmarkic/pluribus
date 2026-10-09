/**
 * Secure storage: getPasswordIfUnlocked.
 *
 * The invariant under test: it NEVER prompts for biometrics, in any mode, on
 * any platform. It returns a password only when the credentials are already
 * usable without a prompt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mocks, stores } = vi.hoisted(() => ({
  mocks: {
    promptTouchID: vi.fn(async () => {}),
    canPromptTouchID: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
    isEncryptionAvailable: vi.fn(() => true),
    powerHandlers: new Map<string, Array<() => void>>(),
  },
  stores: [] as Array<Map<string, unknown>>,
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
    getSelectedStorageBackend: () => 'gnome_libsecret',
  },
  systemPreferences: {
    promptTouchID: mocks.promptTouchID,
    canPromptTouchID: mocks.canPromptTouchID,
  },
  powerMonitor: {
    on: (event: string, handler: () => void) => {
      mocks.powerHandlers.set(event, [...(mocks.powerHandlers.get(event) ?? []), handler]);
    },
  },
}));

vi.mock('electron-store', () => ({
  default: class FakeStore {
    data = new Map<string, unknown>();
    constructor() {
      stores.push(this.data);
    }
    get(key: string) {
      return this.data.get(key);
    }
    set(key: string, value: unknown) {
      this.data.set(key, value);
    }
    delete(key: string) {
      this.data.delete(key);
    }
  },
}));

import { createSecureStorage } from './index';
import type { BiometricMode } from '../../core/ports';

const ACCOUNT = 'me@example.com';
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Storage with a stored password, in the given mode. Session cache starts populated by setPassword. */
async function makeStorage(mode: BiometricMode, sessionTimeoutMs = 4 * 60 * 60 * 1000) {
  const storage = createSecureStorage();
  storage.setConfig({ biometricMode: mode, sessionTimeoutMs });
  await storage.setPassword(ACCOUNT, 'hunter2');
  return storage;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.powerHandlers.clear();
  stores.length = 0;
  setPlatform('darwin');
});

afterEach(() => {
  vi.useRealTimers();
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
});

describe('getPasswordIfUnlocked on macOS (biometric platform)', () => {
  it("'session': a cached password is returned without prompting", async () => {
    const storage = await makeStorage('session');
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it("'lock': a cached password is returned without prompting", async () => {
    const storage = await makeStorage('lock');
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it("'session': an expired cache entry yields null, never a prompt", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T09:00:00Z'));
    const storage = await makeStorage('session', 60_000);

    vi.setSystemTime(new Date('2026-03-10T09:00:30Z'));
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');

    vi.setSystemTime(new Date('2026-03-10T09:02:00Z'));
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBeNull();
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
    expect(mocks.decryptString).not.toHaveBeenCalled();
  });

  it("'session': after the session is cleared (lock screen / suspend) it is locked → null", async () => {
    const storage = await makeStorage('session');
    storage.clearSession();
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBeNull();
    // ... and nothing was decrypted behind the scenes.
    expect(mocks.decryptString).not.toHaveBeenCalled();
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it("'session': the lock-screen power event locks it", async () => {
    const storage = await makeStorage('session');
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');
    for (const h of mocks.powerHandlers.get('lock-screen') ?? []) h();
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBeNull();
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it("'always': null (every access needs a prompt) even though the password is stored", async () => {
    const storage = await makeStorage('always');
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBeNull();
    expect(mocks.decryptString).not.toHaveBeenCalled();
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it("'never': decrypts from the store without prompting, even with an empty session", async () => {
    const storage = await makeStorage('never');
    storage.clearSession();
    mocks.decryptString.mockClear();

    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');
    expect(mocks.decryptString).toHaveBeenCalledTimes(1);
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it('returns null for an account with no stored password, in every mode', async () => {
    for (const mode of ['always', 'session', 'lock', 'never'] as const) {
      const storage = await makeStorage(mode);
      await expect(storage.getPasswordIfUnlocked('nobody@example.com')).resolves.toBeNull();
    }
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it("'never': a corrupt stored value yields null instead of throwing", async () => {
    const storage = await makeStorage('never');
    storage.clearSession();
    mocks.decryptString.mockImplementationOnce(() => {
      throw new Error('bad ciphertext');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBeNull();
    spy.mockRestore();
  });

  it('never calls promptTouchID in any mode, cached or not', async () => {
    for (const mode of ['always', 'session', 'lock', 'never'] as const) {
      const storage = await makeStorage(mode);
      await storage.getPasswordIfUnlocked(ACCOUNT);
      storage.clearSession();
      await storage.getPasswordIfUnlocked(ACCOUNT);
    }
    expect(mocks.promptTouchID).not.toHaveBeenCalled();
  });

  it('sanity: the prompting getPassword DOES call promptTouchID when locked (the spy is wired)', async () => {
    const storage = await makeStorage('session');
    storage.clearSession();
    await expect(storage.getPassword(ACCOUNT)).resolves.toBe('hunter2');
    expect(mocks.promptTouchID).toHaveBeenCalledTimes(1);
  });

  it('does not extend or refresh the session: a hit leaves the original expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T09:00:00Z'));
    const storage = await makeStorage('session', 60_000);

    vi.setSystemTime(new Date('2026-03-10T09:00:50Z'));
    await storage.getPasswordIfUnlocked(ACCOUNT);
    vi.setSystemTime(new Date('2026-03-10T09:01:10Z'));
    await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBeNull();
  });
});

describe('getPasswordIfUnlocked on platforms without a biometric gate', () => {
  it.each(['linux', 'win32'] as const)(
    '%s: decrypts without prompting even when the session is empty or expired (nothing to unlock)',
    async (platform) => {
      setPlatform(platform);
      for (const mode of ['session', 'lock', 'never'] as const) {
        const storage = await makeStorage(mode);
        storage.clearSession();
        await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');
      }
      expect(mocks.promptTouchID).not.toHaveBeenCalled();
    },
  );

  it.each(['linux', 'win32'] as const)(
    "%s: 'always' behaves like getPassword does today (no prompt exists), so it decrypts",
    async (platform) => {
      setPlatform(platform);
      const storage = await makeStorage('always');
      await expect(storage.getPasswordIfUnlocked(ACCOUNT)).resolves.toBe('hunter2');
      await expect(storage.getPassword(ACCOUNT)).resolves.toBe('hunter2');
      expect(mocks.promptTouchID).not.toHaveBeenCalled();
    },
  );

  it('linux: the decrypted value is not cached in the session when mode is always', async () => {
    setPlatform('linux');
    const storage = await makeStorage('always');
    mocks.decryptString.mockClear();
    await storage.getPasswordIfUnlocked(ACCOUNT);
    await storage.getPasswordIfUnlocked(ACCOUNT);
    expect(mocks.decryptString).toHaveBeenCalledTimes(2);
  });

  it('returns null for unknown accounts', async () => {
    setPlatform('linux');
    const storage = await makeStorage('session');
    await expect(storage.getPasswordIfUnlocked('nobody@example.com')).resolves.toBeNull();
  });
});
