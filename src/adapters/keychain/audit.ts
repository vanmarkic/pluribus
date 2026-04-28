/**
 * Audit-log decorator for the keychain (#98).
 *
 * Wraps a SecureStorage port so every credential read / write / delete
 * emits a row into the security_events table. The decorator is
 * defensive: if the sink throws or rejects, the keychain call still
 * succeeds and the failure is surfaced via optional onSinkError.
 */

import type { SecureStorage, SecurityEventRepo } from '../../core/ports';

type AuditOptions = {
  onSinkError?: (err: unknown) => void;
};

// We never record the secret value, only its target (service name or
// account identifier) and whether the call succeeded.
function safeRecord(
  events: SecurityEventRepo,
  entry: Parameters<SecurityEventRepo['record']>[0],
  options: AuditOptions,
): void {
  events.record(entry).catch(err => options.onSinkError?.(err));
}

export function wrapSecureStorageWithAudit(
  inner: SecureStorage,
  events: SecurityEventRepo,
  options: AuditOptions = {},
): SecureStorage {
  return {
    async setPassword(account, password) {
      try {
        await inner.setPassword(account, password);
        safeRecord(events, {
          eventType: 'credential.password.write',
          severity: 'info',
          actor: 'keychain',
          target: account,
        }, options);
      } catch (err) {
        safeRecord(events, {
          eventType: 'credential.password.write',
          severity: 'alert',
          actor: 'keychain',
          target: account,
          success: false,
          metadata: { error: err instanceof Error ? err.message : String(err) },
        }, options);
        throw err;
      }
    },

    async getPassword(account) {
      try {
        const value = await inner.getPassword(account);
        safeRecord(events, {
          eventType: 'credential.password.read',
          severity: 'info',
          actor: 'keychain',
          target: account,
          metadata: { hit: value !== null },
        }, options);
        return value;
      } catch (err) {
        safeRecord(events, {
          eventType: 'credential.password.read',
          severity: 'alert',
          actor: 'keychain',
          target: account,
          success: false,
          metadata: { error: err instanceof Error ? err.message : String(err) },
        }, options);
        throw err;
      }
    },

    async deletePassword(account) {
      try {
        const deleted = await inner.deletePassword(account);
        safeRecord(events, {
          eventType: 'credential.password.delete',
          severity: 'warn',
          actor: 'keychain',
          target: account,
          metadata: { deleted },
        }, options);
        return deleted;
      } catch (err) {
        safeRecord(events, {
          eventType: 'credential.password.delete',
          severity: 'alert',
          actor: 'keychain',
          target: account,
          success: false,
          metadata: { error: err instanceof Error ? err.message : String(err) },
        }, options);
        throw err;
      }
    },

    async setApiKey(service, key) {
      try {
        await inner.setApiKey(service, key);
        safeRecord(events, {
          eventType: 'credential.api_key.write',
          severity: 'warn',
          actor: 'keychain',
          target: service,
        }, options);
      } catch (err) {
        safeRecord(events, {
          eventType: 'credential.api_key.write',
          severity: 'alert',
          actor: 'keychain',
          target: service,
          success: false,
          metadata: { error: err instanceof Error ? err.message : String(err) },
        }, options);
        throw err;
      }
    },

    async getApiKey(service) {
      try {
        const value = await inner.getApiKey(service);
        safeRecord(events, {
          eventType: 'credential.api_key.read',
          severity: 'info',
          actor: 'keychain',
          target: service,
          metadata: { hit: value !== null },
        }, options);
        return value;
      } catch (err) {
        safeRecord(events, {
          eventType: 'credential.api_key.read',
          severity: 'alert',
          actor: 'keychain',
          target: service,
          success: false,
          metadata: { error: err instanceof Error ? err.message : String(err) },
        }, options);
        throw err;
      }
    },

    clearSession() {
      inner.clearSession();
      safeRecord(events, {
        eventType: 'credential.session.clear',
        severity: 'info',
        actor: 'keychain',
      }, options);
    },

    getConfig() {
      return inner.getConfig();
    },

    setConfig(config) {
      inner.setConfig(config);
      safeRecord(events, {
        eventType: 'credential.config.update',
        severity: 'warn',
        actor: 'keychain',
        metadata: config as Record<string, unknown>,
      }, options);
    },

    isBiometricAvailable() {
      return inner.isBiometricAvailable();
    },
  };
}
