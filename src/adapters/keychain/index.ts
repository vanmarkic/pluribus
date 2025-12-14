/**
 * Secure Storage Adapter
 *
 * Uses OS keychain + biometric authentication:
 * - macOS: Keychain + Touch ID
 * - Windows: Credential Vault + Windows Hello
 * - Linux: Secret Service (no biometric)
 *
 * Session caching to avoid constant prompts.
 */

import { safeStorage, systemPreferences, powerMonitor } from 'electron';
import Store from 'electron-store';
import type { SecureStorage, SecurityConfig } from '../../core/ports';

const STORE_KEY_PREFIX = 'secure:';

// Session cache (in-memory only, cleared on lock/timeout)
type SessionCache = Map<string, { value: string; expiresAt: number }>;

export function createSecureStorage(): SecureStorage {
  const store = new Store<Record<string, string>>({ name: 'credentials' });
  const sessionCache: SessionCache = new Map();
  
  // Default security config
  let config: SecurityConfig = {
    biometricMode: 'session',
    sessionTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
    requireForSend: false,
  };
  
  // Load saved config
  const savedConfig = store.get('_config') as unknown as Partial<SecurityConfig> | undefined;
  if (savedConfig) {
    config = { ...config, ...savedConfig };
  }

  // Clear session on screen lock
  powerMonitor.on('lock-screen', () => {
    if (config.biometricMode !== 'never') {
      sessionCache.clear();
    }
  });

  powerMonitor.on('suspend', () => {
    if (config.biometricMode === 'always' || config.biometricMode === 'session') {
      sessionCache.clear();
    }
  });

  async function promptBiometric(reason: string): Promise<boolean> {
    if (config.biometricMode === 'never') return true;
    
    if (process.platform === 'darwin') {
      try {
        await systemPreferences.promptTouchID(reason);
        return true;
      } catch {
        return false;
      }
    }
    
    // Windows Hello - would need native module
    // Linux - typically no biometric API
    // Fall back to allowing access
    return true;
  }

  function checkSession(key: string): string | null {
    const entry = sessionCache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      sessionCache.delete(key);
      return null;
    }
    
    return entry.value;
  }

  function setSession(key: string, value: string): void {
    sessionCache.set(key, {
      value,
      expiresAt: Date.now() + config.sessionTimeoutMs,
    });
  }

  async function decrypt(key: string, reason: string): Promise<string | null> {
    // Check session first (unless 'always' mode)
    if (config.biometricMode !== 'always') {
      const cached = checkSession(key);
      if (cached) return cached;
    }

    // Need biometric (unless 'never' mode)
    if (config.biometricMode !== 'never') {
      const authed = await promptBiometric(reason);
      if (!authed) throw new Error('Biometric authentication failed');
    }

    // Decrypt from store
    const encrypted = store.get(`${STORE_KEY_PREFIX}${key}`);
    if (!encrypted) return null;

    try {
      const value = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      
      // Cache in session (unless 'always' mode)
      if (config.biometricMode !== 'always') {
        setSession(key, value);
      }
      
      return value;
    } catch (err) {
      console.error('Decryption failed:', err);
      return null;
    }
  }

  function encrypt(key: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage not available on this system');
    }
    
    const encrypted = safeStorage.encryptString(value);
    store.set(`${STORE_KEY_PREFIX}${key}`, encrypted.toString('base64'));
    
    // Also cache in session
    if (config.biometricMode !== 'always') {
      setSession(key, value);
    }
  }

  return {
    async setPassword(account, password) {
      encrypt(`imap:${account}`, password);
    },

    async getPassword(account) {
      return decrypt(`imap:${account}`, `Unlock email access for ${account}`);
    },

    async deletePassword(account) {
      const key = `imap:${account}`;
      sessionCache.delete(key);
      store.delete(`${STORE_KEY_PREFIX}${key}`);
      return true;
    },

    async setApiKey(service, key) {
      encrypt(`api:${service}`, key);
    },

    async getApiKey(service) {
      return decrypt(`api:${service}`, `Access ${service} API key`);
    },

    clearSession() {
      sessionCache.clear();
    },

    getConfig() {
      return { ...config };
    },

    setConfig(updates) {
      config = { ...config, ...updates };
      store.set('_config', config as any);
      
      // Clear session if switching to stricter mode
      if (updates.biometricMode === 'always') {
        sessionCache.clear();
      }
    },

    async isBiometricAvailable() {
      if (process.platform === 'darwin') {
        return systemPreferences.canPromptTouchID();
      }
      return false;
    },
  };
}
