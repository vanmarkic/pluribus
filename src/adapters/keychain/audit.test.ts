import { describe, it, expect, vi } from 'vitest';
import { wrapSecureStorageWithAudit } from './audit';
import type { SecureStorage, SecurityEventRepo, SecurityEventEntry } from '../../core/ports';

function mkSink() {
  const records: SecurityEventEntry[] = [];
  const record = vi.fn(async (e: SecurityEventEntry) => { records.push(e); });
  const repo: SecurityEventRepo = {
    record,
    listRecent: async () => [],
    countByType: async () => ({}),
    prune: async () => 0,
  };
  return { repo, records, record };
}

function mkSecrets(overrides: Partial<SecureStorage> = {}): SecureStorage {
  return {
    setPassword: vi.fn(async () => {}),
    getPassword: vi.fn(async () => 'pw'),
    deletePassword: vi.fn(async () => true),
    setApiKey: vi.fn(async () => {}),
    getApiKey: vi.fn(async () => 'sk-123'),
    getPasswordIfUnlocked: vi.fn(async () => 'pw'),
    clearSession: vi.fn(),
    getConfig: vi.fn(() => ({ biometricMode: 'never', sessionTimeoutMs: 0, requireForSend: false })),
    setConfig: vi.fn(),
    isBiometricAvailable: vi.fn(async () => false),
    ...overrides,
  };
}

describe('wrapSecureStorageWithAudit', () => {
  // Allow the fire-and-forget sink call to settle before assertions.
  const flush = () => new Promise(r => setImmediate(r));

  it('records a read event on getApiKey with target + hit metadata', async () => {
    const inner = mkSecrets();
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    const value = await wrapped.getApiKey('anthropic');
    await flush();

    expect(value).toBe('sk-123');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventType: 'credential.api_key.read',
      severity: 'info',
      actor: 'keychain',
      target: 'anthropic',
    });
    expect(records[0].metadata).toEqual({ hit: true });
  });

  it('never forwards the secret value into the audit row', async () => {
    const inner = mkSecrets({ getPassword: vi.fn(async () => 'hunter2') });
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    await wrapped.getPassword('user@example.com');
    await flush();

    const serialised = JSON.stringify(records);
    expect(serialised).not.toContain('hunter2');
  });

  describe('getPasswordIfUnlocked (unattended read)', () => {
    it('forwards the result, records a non-interactive read event, and never leaks the value', async () => {
      const inner = mkSecrets({ getPasswordIfUnlocked: vi.fn(async () => 'hunter2') });
      const { repo, records } = mkSink();
      const wrapped = wrapSecureStorageWithAudit(inner, repo);

      const value = await wrapped.getPasswordIfUnlocked('user@example.com');
      await flush();

      expect(value).toBe('hunter2');
      expect(inner.getPasswordIfUnlocked).toHaveBeenCalledWith('user@example.com');
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        eventType: 'credential.password.read',
        severity: 'info',
        actor: 'keychain',
        target: 'user@example.com',
      });
      expect(records[0]?.metadata).toEqual({ hit: true, interactive: false });
      expect(JSON.stringify(records)).not.toContain('hunter2');
    });

    it('records hit:false and returns null when the credentials are locked', async () => {
      const inner = mkSecrets({ getPasswordIfUnlocked: vi.fn(async () => null) });
      const { repo, records } = mkSink();
      const wrapped = wrapSecureStorageWithAudit(inner, repo);

      await expect(wrapped.getPasswordIfUnlocked('user@example.com')).resolves.toBeNull();
      await flush();

      expect(records[0]?.metadata).toEqual({ hit: false, interactive: false });
    });

    it('never touches the prompting getPassword of the inner storage', async () => {
      const inner = mkSecrets();
      const { repo } = mkSink();
      const wrapped = wrapSecureStorageWithAudit(inner, repo);

      await wrapped.getPasswordIfUnlocked('user@example.com');

      expect(inner.getPassword).not.toHaveBeenCalled();
    });

    it('records an alert row and rethrows when the inner read throws', async () => {
      const inner = mkSecrets({
        getPasswordIfUnlocked: vi.fn(async () => { throw new Error('keychain locked'); }),
      });
      const { repo, records } = mkSink();
      const wrapped = wrapSecureStorageWithAudit(inner, repo);

      await expect(wrapped.getPasswordIfUnlocked('user@example.com')).rejects.toThrow('keychain locked');
      await flush();

      expect(records[0]).toMatchObject({ severity: 'alert', success: false });
      expect(records[0]?.metadata).toMatchObject({ error: 'keychain locked' });
    });

    it('survives a failing audit sink', async () => {
      const inner = mkSecrets();
      const failing: SecurityEventRepo = {
        record: vi.fn(async () => { throw new Error('db full'); }),
        listRecent: async () => [],
        countByType: async () => ({}),
        prune: async () => 0,
      };
      const onSinkError = vi.fn();
      const wrapped = wrapSecureStorageWithAudit(inner, failing, { onSinkError });

      await expect(wrapped.getPasswordIfUnlocked('user@example.com')).resolves.toBe('pw');
      await flush();
      expect(onSinkError).toHaveBeenCalledTimes(1);
    });
  });

  it('marks a write with higher severity for API keys than for passwords', async () => {
    const inner = mkSecrets();
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    await wrapped.setPassword('user@example.com', 'pw');
    await wrapped.setApiKey('anthropic', 'sk-new');
    await flush();

    expect(records[0].severity).toBe('info');
    expect(records[1].severity).toBe('warn');
  });

  it('still records an alert row when the underlying call throws', async () => {
    const inner = mkSecrets({
      getApiKey: vi.fn(async () => { throw new Error('boom'); }),
    });
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    await expect(wrapped.getApiKey('anthropic')).rejects.toThrow('boom');
    await flush();

    expect(records).toHaveLength(1);
    expect(records[0].severity).toBe('alert');
    expect(records[0].success).toBe(false);
    expect(records[0].metadata).toMatchObject({ error: 'boom' });
  });

  it('calls onSinkError when the audit sink rejects but does not disturb the keychain call', async () => {
    const inner = mkSecrets();
    const failing: SecurityEventRepo = {
      record: vi.fn(async () => { throw new Error('db full'); }),
      listRecent: async () => [],
      countByType: async () => ({}),
      prune: async () => 0,
    };
    const onSinkError = vi.fn();
    const wrapped = wrapSecureStorageWithAudit(inner, failing, { onSinkError });

    const value = await wrapped.getApiKey('anthropic');
    await flush();

    expect(value).toBe('sk-123'); // user-facing call still succeeded
    expect(onSinkError).toHaveBeenCalledTimes(1);
  });

  it('logs deletion events as warn severity and includes whether anything was removed', async () => {
    const inner = mkSecrets({ deletePassword: vi.fn(async () => false) });
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    const result = await wrapped.deletePassword('user@example.com');
    await flush();

    expect(result).toBe(false);
    expect(records[0]).toMatchObject({
      eventType: 'credential.password.delete',
      severity: 'warn',
      target: 'user@example.com',
    });
    expect(records[0].metadata).toEqual({ deleted: false });
  });

  it('emits a session-clear event with info severity', async () => {
    const inner = mkSecrets();
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    wrapped.clearSession();
    await flush();

    expect(records[0]).toMatchObject({
      eventType: 'credential.session.clear',
      severity: 'info',
    });
  });

  it('passes through getConfig / isBiometricAvailable without recording', async () => {
    const inner = mkSecrets();
    const { repo, records } = mkSink();
    const wrapped = wrapSecureStorageWithAudit(inner, repo);

    wrapped.getConfig();
    await wrapped.isBiometricAvailable();
    await flush();

    expect(records).toHaveLength(0);
  });
});
