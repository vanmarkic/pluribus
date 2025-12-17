/**
 * Account, Credentials & Security IPC Handlers
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertBoolean,
  assertString,
} from './validation';

const ALLOWED_SERVICES = ['anthropic'] as const;
const MAX_PASSWORD_LENGTH = 500;

// ==========================================
// Setup Function
// ==========================================

export function setupAccountHandlers(container: Container): void {
  const { useCases, deps } = container;

  // ==========================================
  // Account List
  // ==========================================

  ipcMain.handle('accounts:list', () => useCases.listAccounts());

  // ==========================================
  // Account Management
  // ==========================================

  ipcMain.handle('accounts:get', (_, id) => {
    return useCases.getAccount(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('accounts:create', async (_, account, password) => {
    if (!account || typeof account !== 'object') throw new Error('Invalid account');
    const a = account as Record<string, unknown>;

    const validated = {
      name: assertString(a.name, 'name', 100),
      email: assertString(a.email, 'email', 200),
      imapHost: assertString(a.imapHost, 'imapHost', 200),
      imapPort: assertPositiveInt(a.imapPort, 'imapPort'),
      smtpHost: assertString(a.smtpHost, 'smtpHost', 200),
      smtpPort: assertPositiveInt(a.smtpPort, 'smtpPort'),
      username: assertString(a.username, 'username', 200),
    };

    const pw = assertString(password, 'password', 500);
    return useCases.createAccount(validated, pw);
  });

  ipcMain.handle('accounts:add', async (_, account, password, options) => {
    if (!account || typeof account !== 'object') throw new Error('Invalid account');
    const a = account as Record<string, unknown>;

    const validated = {
      name: assertString(a.name, 'name', 100),
      email: assertString(a.email, 'email', 200),
      imapHost: assertString(a.imapHost, 'imapHost', 200),
      imapPort: assertPositiveInt(a.imapPort, 'imapPort'),
      smtpHost: assertString(a.smtpHost, 'smtpHost', 200),
      smtpPort: assertPositiveInt(a.smtpPort, 'smtpPort'),
      username: assertString(a.username, 'username', 200),
    };

    const pw = assertString(password, 'password', 500);

    const opts: { skipSync?: boolean } = {};
    if (options && typeof options === 'object') {
      const o = options as Record<string, unknown>;
      if (o.skipSync !== undefined) opts.skipSync = assertBoolean(o.skipSync, 'skipSync');
    }

    return useCases.addAccount(validated, pw, opts);
  });

  ipcMain.handle('accounts:update', async (_, id, updates, newPassword) => {
    const validId = assertPositiveInt(id, 'id');

    if (!updates || typeof updates !== 'object') throw new Error('Invalid updates');
    const u = updates as Record<string, unknown>;
    const validated: Record<string, unknown> = {};

    if (u.name !== undefined) validated.name = assertString(u.name, 'name', 100);
    if (u.imapHost !== undefined) validated.imapHost = assertString(u.imapHost, 'imapHost', 200);
    if (u.imapPort !== undefined) validated.imapPort = assertPositiveInt(u.imapPort, 'imapPort');
    if (u.smtpHost !== undefined) validated.smtpHost = assertString(u.smtpHost, 'smtpHost', 200);
    if (u.smtpPort !== undefined) validated.smtpPort = assertPositiveInt(u.smtpPort, 'smtpPort');

    const pw = newPassword ? assertString(newPassword, 'newPassword', 500) : undefined;
    return useCases.updateAccount(validId, validated, pw);
  });

  ipcMain.handle('accounts:delete', (_, id) => {
    return useCases.deleteAccount(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('accounts:testImap', async (_, email, imapHost, imapPort) => {
    const e = assertString(email, 'email', 200);
    const h = assertString(imapHost, 'imapHost', 200);
    const p = assertPositiveInt(imapPort, 'imapPort');
    return useCases.testImapConnection(e, h, p);
  });

  ipcMain.handle('accounts:testSmtp', async (_, email, smtpHost, smtpPort) => {
    const e = assertString(email, 'email', 200);
    const h = assertString(smtpHost, 'smtpHost', 200);
    const p = assertPositiveInt(smtpPort, 'smtpPort');
    return useCases.testSmtpConnection(e, { host: h, port: p, secure: p === 465 });
  });

  // ==========================================
  // Credentials (stored encrypted, biometric-gated)
  // NOTE: getPassword/getApiKey intentionally NOT exposed to renderer
  // ==========================================

  ipcMain.handle('credentials:setPassword', (_, account, password) => {
    const a = assertString(account, 'account', 200);
    const p = assertString(password, 'password', MAX_PASSWORD_LENGTH);
    return deps.secrets.setPassword(a, p);
  });

  ipcMain.handle('credentials:hasPassword', async (_, account) => {
    const a = assertString(account, 'account', 200);
    try {
      const pw = await deps.secrets.getPassword(a);
      return pw !== null;
    } catch {
      return false; // Biometric failed = treat as not available
    }
  });

  ipcMain.handle('credentials:deletePassword', (_, account) => {
    return deps.secrets.deletePassword(assertString(account, 'account', 200));
  });

  ipcMain.handle('credentials:setApiKey', (_, service, key) => {
    const s = assertString(service, 'service', 50);
    if (!ALLOWED_SERVICES.includes(s as (typeof ALLOWED_SERVICES)[number])) {
      throw new Error(`Service not allowed: ${s}`);
    }
    const k = assertString(key, 'key', MAX_PASSWORD_LENGTH);
    return deps.secrets.setApiKey(s, k);
  });

  ipcMain.handle('credentials:hasApiKey', async (_, service) => {
    const s = assertString(service, 'service', 50);
    if (!ALLOWED_SERVICES.includes(s as (typeof ALLOWED_SERVICES)[number])) {
      throw new Error(`Service not allowed: ${s}`);
    }
    try {
      const key = await deps.secrets.getApiKey(s);
      return key !== null;
    } catch {
      return false;
    }
  });

  // ==========================================
  // Security Settings
  // ==========================================

  ipcMain.handle('security:getConfig', () => deps.secrets.getConfig());

  ipcMain.handle('security:setConfig', (_, updates) => {
    if (!updates || typeof updates !== 'object') throw new Error('Invalid updates');
    const u = updates as Record<string, unknown>;
    const validated: Record<string, unknown> = {};

    if (u.biometricMode !== undefined) {
      const validModes = ['always', 'session', 'lock', 'never'];
      const mode = assertString(u.biometricMode, 'biometricMode', 20);
      if (!validModes.includes(mode)) throw new Error('Invalid biometricMode');
      validated.biometricMode = mode;
    }
    if (u.sessionTimeoutMs !== undefined) {
      validated.sessionTimeoutMs = assertPositiveInt(u.sessionTimeoutMs, 'sessionTimeoutMs');
    }
    if (u.requireForSend !== undefined) {
      validated.requireForSend = assertBoolean(u.requireForSend, 'requireForSend');
    }

    return deps.secrets.setConfig(validated);
  });

  ipcMain.handle('security:clearSession', () => deps.secrets.clearSession());
  ipcMain.handle('security:isBiometricAvailable', () => deps.secrets.isBiometricAvailable());
}
