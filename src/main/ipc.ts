/**
 * IPC Handlers
 *
 * Bridges renderer process to use cases.
 * All inputs validated at boundary.
 */

import { ipcMain, BrowserWindow, shell } from 'electron';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import sanitizeFilename = require('sanitize-filename');
import type { Container } from './container';
import type { DraftInput } from '../core/domain';

// ==========================================
// Rate Limiting
// ==========================================

const rateLimiters = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(handler: string, maxPerMinute: number): void {
  const now = Date.now();
  const limiter = rateLimiters.get(handler);

  if (!limiter || now > limiter.resetAt) {
    rateLimiters.set(handler, { count: 1, resetAt: now + 60000 });
    return;
  }

  if (limiter.count >= maxPerMinute) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  limiter.count++;
}

// ==========================================
// Input Validation Helpers
// ==========================================

function assertPositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}: must be a positive integer`);
  }
  return value;
}

function assertNonNegativeInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: must be a non-negative integer`);
  }
  return value;
}

function assertString(value: unknown, name: string, maxLength = 1000): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}: must be a string`);
  }
  if (value.length > maxLength) {
    throw new Error(`Invalid ${name}: exceeds max length of ${maxLength}`);
  }
  return value;
}

function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: must be a boolean`);
  }
  return value;
}

function assertOptionalPositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return assertPositiveInt(value, name);
}

function assertListOptions(opts: unknown): Record<string, unknown> {
  if (opts === undefined || opts === null) return {};
  if (typeof opts !== 'object') throw new Error('Invalid options: must be an object');

  const validated: Record<string, unknown> = {};
  const o = opts as Record<string, unknown>;

  if (o.accountId !== undefined) validated.accountId = assertPositiveInt(o.accountId, 'accountId');
  if (o.tagId !== undefined) validated.tagId = assertPositiveInt(o.tagId, 'tagId');
  if (o.folderId !== undefined) validated.folderId = assertPositiveInt(o.folderId, 'folderId');
  if (o.folderPath !== undefined) validated.folderPath = assertString(o.folderPath, 'folderPath', 200);
  if (o.unreadOnly !== undefined) validated.unreadOnly = assertBoolean(o.unreadOnly, 'unreadOnly');
  if (o.starredOnly !== undefined) validated.starredOnly = assertBoolean(o.starredOnly, 'starredOnly');
  if (o.limit !== undefined) validated.limit = assertPositiveInt(o.limit, 'limit');
  if (o.offset !== undefined) validated.offset = assertNonNegativeInt(o.offset, 'offset');

  return validated;
}

export function registerIpcHandlers(window: BrowserWindow, container: Container): void {
  const { useCases, deps, config } = container;

  // ==========================================
  // Emails
  // ==========================================

  ipcMain.handle('emails:list', (_, opts) => {
    const validated = assertListOptions(opts);
    return useCases.listEmails(validated);
  });

  ipcMain.handle('emails:get', (_, id) => {
    return useCases.getEmail(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:getBody', (_, id) => {
    return useCases.getEmailBody(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:search', (_, query, limit, accountId) => {
    const q = assertString(query, 'query', 500);
    const l = assertOptionalPositiveInt(limit, 'limit') ?? 100;
    const aId = assertOptionalPositiveInt(accountId, 'accountId');
    return useCases.searchEmails(q, l, aId);
  });

  ipcMain.handle('emails:markRead', (_, id, isRead) => {
    return useCases.markRead(assertPositiveInt(id, 'id'), assertBoolean(isRead, 'isRead'));
  });

  ipcMain.handle('emails:star', (_, id, isStarred) => {
    return useCases.starEmail(assertPositiveInt(id, 'id'), assertBoolean(isStarred, 'isStarred'));
  });

  ipcMain.handle('emails:archive', (_, id) => {
    return useCases.archiveEmail(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('emails:delete', (_, id) => {
    return useCases.deleteEmail(assertPositiveInt(id, 'id'));
  });

  // ==========================================
  // Attachments
  // ==========================================

  ipcMain.handle('attachments:getForEmail', (_, emailId) => {
    return deps.attachments.findByEmailId(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('attachments:download', async (_, attachmentId, action) => {
    checkRateLimit('attachments:download', 30);
    const id = assertPositiveInt(attachmentId, 'attachmentId');
    const actionType = action ? assertString(action, 'action', 10) : 'open';
    if (!['open', 'save'].includes(actionType)) throw new Error('Invalid action');

    // Get attachment metadata and content
    const attachment = await deps.attachments.findById(id);
    if (!attachment) throw new Error('Attachment not found');

    const content = await deps.attachments.getContent(id);
    if (!content) throw new Error('Attachment content not found');

    // Save to temp directory
    const tempDir = path.join(app.getPath('temp'), 'mail-attachments');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Sanitize filename to prevent path traversal attacks
    const safeFilename = sanitizeFilename(attachment.filename, { replacement: '_' });
    if (!safeFilename) throw new Error('Invalid attachment filename');
    const tempPath = path.join(tempDir, `${id}-${safeFilename}`);

    fs.writeFileSync(tempPath, content);

    if (actionType === 'open') {
      await shell.openPath(tempPath);
      return { path: tempPath, action: 'opened' };
    } else {
      // For save, we could use dialog.showSaveDialog here
      // For now, just return the temp path
      return { path: tempPath, action: 'saved' };
    }
  });

  // ==========================================
  // Tags
  // ==========================================

  ipcMain.handle('tags:list', () => useCases.listTags());

  ipcMain.handle('tags:getForEmail', (_, emailId) => {
    return useCases.getEmailTags(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('tags:apply', (_, emailId, tagId, source) => {
    const validSources = ['manual', 'llm', 'rule'];
    const s = source ? assertString(source, 'source', 20) : 'manual';
    if (!validSources.includes(s)) throw new Error('Invalid source');
    return useCases.applyTag(
      assertPositiveInt(emailId, 'emailId'),
      assertPositiveInt(tagId, 'tagId'),
      s
    );
  });

  ipcMain.handle('tags:remove', (_, emailId, tagId) => {
    return useCases.removeTag(
      assertPositiveInt(emailId, 'emailId'),
      assertPositiveInt(tagId, 'tagId')
    );
  });

  ipcMain.handle('tags:create', (_, tag) => {
    if (!tag || typeof tag !== 'object') throw new Error('Invalid tag');
    const t = tag as Record<string, unknown>;
    return useCases.createTag({
      name: assertString(t.name, 'name', 100),
      slug: assertString(t.slug, 'slug', 50),
      color: t.color ? assertString(t.color, 'color', 20) : '#6b7280',
      isSystem: t.isSystem ? assertBoolean(t.isSystem, 'isSystem') : false,
      sortOrder: t.sortOrder ? assertNonNegativeInt(t.sortOrder, 'sortOrder') : 0,
    });
  });

  // ==========================================
  // Sync
  // ==========================================

  ipcMain.handle('sync:start', async (_, accountId, opts) => {
    checkRateLimit('sync:start', 10);
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.headersOnly !== undefined) validated.headersOnly = assertBoolean(o.headersOnly, 'headersOnly');
      if (o.batchSize !== undefined) validated.batchSize = assertPositiveInt(o.batchSize, 'batchSize');
      if (o.maxMessages !== undefined) validated.maxMessages = assertPositiveInt(o.maxMessages, 'maxMessages');
      if (o.folder !== undefined) validated.folder = assertString(o.folder, 'folder', 200);
    }

    // Use the combined use case (handles auto-classify based on config)
    return useCases.syncWithAutoClassify(assertPositiveInt(accountId, 'accountId'), validated);
  });

  ipcMain.handle('sync:startAll', async (_, opts) => {
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.headersOnly !== undefined) validated.headersOnly = assertBoolean(o.headersOnly, 'headersOnly');
    }

    // Use the combined use case (handles auto-classify based on config)
    return useCases.syncAllWithAutoClassify(validated);
  });

  // Forward sync progress to renderer
  deps.sync.onProgress((progress) => {
    window.webContents.send('sync:progress', progress);
  });

  // ==========================================
  // Classification
  // ==========================================

  ipcMain.handle('llm:classify', async (_, emailId) => {
    checkRateLimit('llm:classify', 30);
    const id = assertPositiveInt(emailId, 'emailId');
    window.webContents.send('llm:classifying', { emailId: id });
    try {
      const result = await useCases.classifyEmail(id);
      window.webContents.send('llm:classified', { emailId: id, result });
      return result;
    } catch (error) {
      window.webContents.send('llm:error', { emailId: id, error: String(error) });
      throw error;
    }
  });

  ipcMain.handle('llm:classifyAndApply', (_, emailId) => {
    return useCases.classifyAndApply(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('llm:getBudget', () => deps.classifier.getBudget());

  ipcMain.handle('llm:getEmailBudget', () => deps.classifier.getEmailBudget());

  // ==========================================
  // LLM Provider
  // ==========================================

  ipcMain.handle('llm:validate', async (_, key) => {
    const k = key ? assertString(key, 'key', 500) : '';
    return useCases.validateLLMProvider(k);
  });

  ipcMain.handle('llm:listModels', () => {
    return useCases.listLLMModels();
  });

  ipcMain.handle('llm:testConnection', () => {
    return useCases.testLLMConnection();
  });

  ipcMain.handle('llm:startOllama', async () => {
    const { startOllama } = await import('../adapters/llm/ollama');
    const llmConfig = container.config.get('llm');
    return startOllama(llmConfig.ollamaServerUrl);
  });

  ipcMain.handle('llm:stopOllama', async () => {
    const { stopOllama } = await import('../adapters/llm/ollama');
    return stopOllama();
  });

  ipcMain.handle('llm:isConfigured', async () => {
    return useCases.isLLMConfigured();
  });

  ipcMain.handle('llm:startBackgroundClassification', async (_, emailIds: number[]) => {
    checkRateLimit('llm:startBackgroundClassification', 5);
    if (!Array.isArray(emailIds)) {
      throw new Error('emailIds must be an array');
    }
    const validIds = emailIds.map((id, i) => {
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
        throw new Error(`Invalid emailIds[${i}]: must be a positive integer`);
      }
      return id;
    });
    return useCases.startBackgroundClassification(validIds);
  });

  ipcMain.handle('llm:getTaskStatus', async (_, taskId: string) => {
    if (typeof taskId !== 'string') {
      throw new Error('taskId must be a string');
    }
    return useCases.getBackgroundTaskStatus(taskId);
  });

  ipcMain.handle('llm:clearTask', async (_, taskId: string) => {
    if (typeof taskId !== 'string') {
      throw new Error('taskId must be a string');
    }
    useCases.clearBackgroundTask(taskId);
  });

  // ==========================================
  // AI Sort (Review Queue & Stats)
  // ==========================================

  ipcMain.handle('aiSort:getPendingReview', (_, opts) => {
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.limit !== undefined) validated.limit = assertPositiveInt(o.limit, 'limit');
      if (o.offset !== undefined) validated.offset = assertNonNegativeInt(o.offset, 'offset');
      if (o.accountId !== undefined) validated.accountId = assertPositiveInt(o.accountId, 'accountId');
      if (o.sortBy !== undefined) {
        const sortBy = assertString(o.sortBy, 'sortBy', 20);
        if (!['confidence', 'date', 'sender'].includes(sortBy)) throw new Error('Invalid sortBy');
        validated.sortBy = sortBy;
      }
    }
    return useCases.getPendingReviewQueue(validated);
  });

  ipcMain.handle('aiSort:getStats', (_, accountId) => {
    const id = assertOptionalPositiveInt(accountId, 'accountId');
    return useCases.getClassificationStats(id);
  });

  ipcMain.handle('aiSort:getPendingCount', () => {
    return useCases.getPendingReviewCount();
  });

  ipcMain.handle('aiSort:getByPriority', (_, priority, opts) => {
    const validPriorities = ['high', 'normal', 'low'];
    const p = assertString(priority, 'priority', 10);
    if (!validPriorities.includes(p)) throw new Error('Invalid priority');

    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.limit !== undefined) validated.limit = assertPositiveInt(o.limit, 'limit');
      if (o.offset !== undefined) validated.offset = assertNonNegativeInt(o.offset, 'offset');
    }
    return useCases.getEmailsByPriority(p as 'high' | 'normal' | 'low', validated);
  });

  ipcMain.handle('aiSort:getFailed', (_, opts) => {
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.limit !== undefined) validated.limit = assertPositiveInt(o.limit, 'limit');
      if (o.offset !== undefined) validated.offset = assertNonNegativeInt(o.offset, 'offset');
    }
    return useCases.getFailedClassifications(validated);
  });

  ipcMain.handle('aiSort:accept', (_, emailId, appliedTags) => {
    const id = assertPositiveInt(emailId, 'emailId');

    if (!Array.isArray(appliedTags)) throw new Error('Invalid appliedTags: must be an array');
    const validatedTags = appliedTags.map((tag, i) => assertString(tag, `appliedTags[${i}]`, 100));

    return useCases.acceptClassification(id, validatedTags);
  });

  ipcMain.handle('aiSort:dismiss', (_, emailId) => {
    return useCases.dismissClassification(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('aiSort:retry', (_, emailId) => {
    return useCases.retryClassification(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('aiSort:getConfusedPatterns', (_, limit, accountId) => {
    const l = assertOptionalPositiveInt(limit, 'limit') ?? 5;
    const id = assertOptionalPositiveInt(accountId, 'accountId');
    return useCases.getConfusedPatterns(l, id);
  });

  ipcMain.handle('aiSort:clearConfusedPatterns', () => {
    return useCases.clearConfusedPatterns();
  });

  ipcMain.handle('aiSort:getRecentActivity', (_, limit, accountId) => {
    const l = assertOptionalPositiveInt(limit, 'limit') ?? 10;
    const id = assertOptionalPositiveInt(accountId, 'accountId');
    return useCases.getRecentActivity(l, id);
  });

  ipcMain.handle('aiSort:bulkAccept', (_, emailIds) => {
    if (!Array.isArray(emailIds)) throw new Error('emailIds must be an array');
    const ids = emailIds.map((id, i) => assertPositiveInt(id, `emailIds[${i}]`));
    return useCases.bulkAcceptClassifications(ids);
  });

  ipcMain.handle('aiSort:bulkDismiss', (_, emailIds) => {
    if (!Array.isArray(emailIds)) throw new Error('emailIds must be an array');
    const ids = emailIds.map((id, i) => assertPositiveInt(id, `emailIds[${i}]`));
    return useCases.bulkDismissClassifications(ids);
  });

  ipcMain.handle('aiSort:bulkApplyTag', (_, emailIds, tagSlug) => {
    if (!Array.isArray(emailIds)) throw new Error('emailIds must be an array');
    const ids = emailIds.map((id, i) => assertPositiveInt(id, `emailIds[${i}]`));
    const slug = assertString(tagSlug, 'tagSlug', 100);
    return useCases.bulkApplyTag(ids, slug);
  });

  ipcMain.handle('aiSort:classifyUnprocessed', async () => {
    checkRateLimit('aiSort:classifyUnprocessed', 5);
    const result = await useCases.classifyUnprocessed();
    // Stop Ollama after classification batch completes to free resources
    const llmConfig = container.config.get('llm');
    if (llmConfig.provider === 'ollama') {
      const { stopOllama } = await import('../adapters/llm/ollama');
      await stopOllama();
    }
    return result;
  });

  // ==========================================
  // Accounts
  // ==========================================

  ipcMain.handle('accounts:list', () => useCases.listAccounts());

  // ==========================================
  // Config (allowlisted keys only)
  // ==========================================

  const ALLOWED_CONFIG_KEYS = ['llm'] as const;
  type AllowedConfigKey = (typeof ALLOWED_CONFIG_KEYS)[number];

  ipcMain.handle('config:get', (_, key) => {
    const k = assertString(key, 'key', 50);
    if (!ALLOWED_CONFIG_KEYS.includes(k as AllowedConfigKey)) {
      throw new Error(`Config key not allowed: ${k}`);
    }
    return config.get(k as AllowedConfigKey);
  });

  ipcMain.handle('config:set', (_, key, value) => {
    const k = assertString(key, 'key', 50);
    if (!ALLOWED_CONFIG_KEYS.includes(k as AllowedConfigKey)) {
      throw new Error(`Config key not allowed: ${k}`);
    }
    // Validate LLM config structure
    if (k === 'llm') {
      if (!value || typeof value !== 'object') throw new Error('Invalid llm config');
      const v = value as Record<string, unknown>;

      // Validate provider
      if (v.provider !== undefined) {
        const validProviders = ['anthropic', 'ollama'];
        if (!validProviders.includes(v.provider as string)) {
          throw new Error('Invalid provider');
        }
      }

      // Validate model (just check it's a string, actual model comes from API)
      if (v.model !== undefined) {
        assertString(v.model, 'model', 100);
      }

      if (v.dailyBudget !== undefined) assertPositiveInt(v.dailyBudget, 'dailyBudget');
      if (v.dailyEmailLimit !== undefined) assertPositiveInt(v.dailyEmailLimit, 'dailyEmailLimit');
      if (v.autoClassify !== undefined) assertBoolean(v.autoClassify, 'autoClassify');
      if (v.confidenceThreshold !== undefined) {
        const ct = v.confidenceThreshold;
        if (typeof ct !== 'number' || ct < 0 || ct > 1) {
          throw new Error('confidenceThreshold must be between 0 and 1');
        }
      }
      if (v.reclassifyCooldownDays !== undefined) {
        const validCooldowns = [1, 3, 7, 14, -1];
        const cd = v.reclassifyCooldownDays;
        if (typeof cd !== 'number' || !validCooldowns.includes(cd)) {
          throw new Error('reclassifyCooldownDays must be 1, 3, 7, 14, or -1 (never)');
        }
      }
      if (v.ollamaServerUrl !== undefined) {
        assertString(v.ollamaServerUrl, 'ollamaServerUrl', 200);
      }
    }
    return config.set(k as AllowedConfigKey, value);
  });

  // ==========================================
  // Credentials (stored encrypted, biometric-gated)
  // NOTE: getPassword/getApiKey intentionally NOT exposed to renderer
  // ==========================================

  const ALLOWED_SERVICES = ['anthropic'] as const;
  const MAX_PASSWORD_LENGTH = 500;

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
  // Send Email
  // ==========================================

  ipcMain.handle('send:email', async (_, accountId, draft) => {
    checkRateLimit('send:email', 20);
    const id = assertPositiveInt(accountId, 'accountId');

    if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
    const d = draft as Record<string, unknown>;
    
    if (!Array.isArray(d.to) || d.to.length === 0) throw new Error('Invalid recipients');
    
    // Validate attachments if present
    let attachments: { filename: string; content: string; contentType?: string }[] | undefined;
    if (Array.isArray(d.attachments)) {
      attachments = (d.attachments as Array<Record<string, unknown>>).map((att, i) => {
        if (!att || typeof att !== 'object') throw new Error(`Invalid attachment at index ${i}`);
        return {
          filename: assertString(att.filename, `attachment[${i}].filename`, 255),
          content: assertString(att.content, `attachment[${i}].content`, 50000000), // ~37MB base64
          contentType: att.contentType ? assertString(att.contentType, `attachment[${i}].contentType`, 100) : undefined,
        };
      });
    }

    const validated = {
      to: (d.to as string[]).map(addr => assertString(addr, 'to', 200)),
      cc: Array.isArray(d.cc) ? (d.cc as string[]).map(addr => assertString(addr, 'cc', 200)) : undefined,
      bcc: Array.isArray(d.bcc) ? (d.bcc as string[]).map(addr => assertString(addr, 'bcc', 200)) : undefined,
      subject: assertString(d.subject, 'subject', 500),
      text: d.text ? assertString(d.text, 'text', 100000) : undefined,
      html: d.html ? assertString(d.html, 'html', 500000) : undefined,
      inReplyTo: d.inReplyTo ? assertString(d.inReplyTo, 'inReplyTo', 500) : undefined,
      references: Array.isArray(d.references) ? (d.references as string[]).map(r => assertString(r, 'reference', 500)) : undefined,
      attachments,
    };

    return useCases.sendEmail(id, validated);
  });

  ipcMain.handle('send:reply', async (_, emailId, body, replyAll) => {
    checkRateLimit('send:reply', 20);
    const id = assertPositiveInt(emailId, 'emailId');

    if (!body || typeof body !== 'object') throw new Error('Invalid body');
    const b = body as Record<string, unknown>;
    
    const validated = {
      text: b.text ? assertString(b.text, 'text', 100000) : undefined,
      html: b.html ? assertString(b.html, 'html', 500000) : undefined,
    };
    
    return useCases.replyToEmail(id, validated, Boolean(replyAll));
  });

  ipcMain.handle('send:forward', async (_, emailId, to, body) => {
    checkRateLimit('send:forward', 20);
    const id = assertPositiveInt(emailId, 'emailId');

    if (!Array.isArray(to) || to.length === 0) throw new Error('Invalid recipients');
    const recipients = (to as string[]).map(addr => assertString(addr, 'to', 200));
    
    if (!body || typeof body !== 'object') throw new Error('Invalid body');
    const b = body as Record<string, unknown>;
    
    const validated = {
      text: b.text ? assertString(b.text, 'text', 100000) : undefined,
      html: b.html ? assertString(b.html, 'html', 500000) : undefined,
    };
    
    return useCases.forwardEmail(id, recipients, validated);
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

  // ==========================================
  // Remote Images
  // ==========================================

  ipcMain.handle('images:getSetting', () => {
    return useCases.getRemoteImagesSetting();
  });

  ipcMain.handle('images:setSetting', (_, setting) => {
    const validSettings = ['block', 'allow', 'auto'];
    const s = assertString(setting, 'setting', 10);
    if (!validSettings.includes(s)) throw new Error('Invalid setting');
    return useCases.setRemoteImagesSetting(s as 'block' | 'allow' | 'auto');
  });

  ipcMain.handle('images:hasLoaded', (_, emailId) => {
    return useCases.hasLoadedRemoteImages(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('images:load', async (_, emailId, urls) => {
    const id = assertPositiveInt(emailId, 'emailId');
    if (!Array.isArray(urls)) throw new Error('Invalid urls: must be an array');
    const validatedUrls = urls.map((url, i) => assertString(url, `urls[${i}]`, 2000));
    return useCases.loadRemoteImages(id, validatedUrls);
  });

  ipcMain.handle('images:clearCache', (_, emailId) => {
    return useCases.clearImageCache(assertPositiveInt(emailId, 'emailId'));
  });

  ipcMain.handle('images:clearAllCache', () => {
    return useCases.clearAllImageCache();
  });

  ipcMain.handle('images:autoLoad', async (_, emailId, urls) => {
    const id = assertPositiveInt(emailId, 'emailId');
    if (!Array.isArray(urls)) throw new Error('Invalid urls: must be an array');
    const validatedUrls = urls.map((url, i) => assertString(url, `urls[${i}]`, 2000));
    return useCases.autoLoadImagesForEmail(id, validatedUrls);
  });

  // ==========================================
  // Drafts
  // ==========================================

  ipcMain.handle('drafts:list', (_, opts) => {
    const validated: Record<string, unknown> = {};
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (o.accountId !== undefined) validated.accountId = assertPositiveInt(o.accountId, 'accountId');
    }
    return useCases.listDrafts(validated);
  });

  ipcMain.handle('drafts:get', (_, id) => {
    return useCases.getDraft(assertPositiveInt(id, 'id'));
  });

  ipcMain.handle('drafts:save', (_, draft) => {
    if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
    const d = draft as Record<string, unknown>;

    const validated: Record<string, unknown> = {
      accountId: assertPositiveInt(d.accountId, 'accountId'),
    };

    if (d.id !== undefined) validated.id = assertPositiveInt(d.id, 'id');
    if (Array.isArray(d.to)) validated.to = (d.to as string[]).map(addr => assertString(addr, 'to', 200));
    if (Array.isArray(d.cc)) validated.cc = (d.cc as string[]).map(addr => assertString(addr, 'cc', 200));
    if (Array.isArray(d.bcc)) validated.bcc = (d.bcc as string[]).map(addr => assertString(addr, 'bcc', 200));
    if (d.subject !== undefined) validated.subject = assertString(d.subject, 'subject', 500);
    if (d.text !== undefined) validated.text = assertString(d.text, 'text', 100000);
    if (d.html !== undefined) validated.html = assertString(d.html, 'html', 500000);
    if (d.inReplyTo !== undefined) validated.inReplyTo = assertString(d.inReplyTo, 'inReplyTo', 500);
    if (Array.isArray(d.references)) validated.references = (d.references as string[]).map(r => assertString(r, 'reference', 500));
    if (d.originalEmailId !== undefined) validated.originalEmailId = assertPositiveInt(d.originalEmailId, 'originalEmailId');

    // Validate attachments
    if (Array.isArray(d.attachments)) {
      validated.attachments = (d.attachments as Record<string, unknown>[]).map((att, i) => {
        if (!att || typeof att !== 'object') throw new Error(`Invalid attachment at index ${i}`);
        return {
          filename: assertString(att.filename, `attachment[${i}].filename`, 255),
          contentType: att.contentType !== undefined ? assertString(att.contentType, `attachment[${i}].contentType`, 100) : undefined,
          size: assertNonNegativeInt(att.size, `attachment[${i}].size`),
          content: assertString(att.content, `attachment[${i}].content`, 50000000), // 50MB base64 limit
        };
      });
    }

    return useCases.saveDraft(validated as DraftInput);
  });

  ipcMain.handle('drafts:delete', (_, id) => {
    return useCases.deleteDraft(assertPositiveInt(id, 'id'));
  });

  // ==========================================
  // Contacts
  // ==========================================

  ipcMain.handle('contacts:getRecent', (_, limit) => {
    const l = limit !== undefined ? assertPositiveInt(limit, 'limit') : undefined;
    return useCases.getRecentContacts(l);
  });

  ipcMain.handle('contacts:search', (_, query, limit) => {
    const q = assertString(query, 'query', 100);
    const l = limit !== undefined ? assertPositiveInt(limit, 'limit') : undefined;
    return useCases.searchContacts(q, l);
  });
}
