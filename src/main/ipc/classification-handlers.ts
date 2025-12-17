/**
 * Classification & AI Sort IPC Handlers (LLM + AI Sort)
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertNonNegativeInt,
  assertString,
  assertOptionalPositiveInt,
  checkRateLimit,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupClassificationHandlers(container: Container, window: BrowserWindow): void {
  const { useCases, deps, config } = container;

  // ==========================================
  // LLM Classification
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
    const { ollamaManager } = container;
    // Check if bundled Ollama is installed
    const isBundledInstalled = await ollamaManager.isInstalled();

    if (isBundledInstalled) {
      // Use bundled Ollama
      try {
        await ollamaManager.start();
        return { started: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { started: false, error: message };
      }
    } else {
      // Fall back to system Ollama
      const { startOllama } = await import('../../adapters/llm/ollama');
      const llmConfig = config.get('llm');
      return startOllama(llmConfig.ollamaServerUrl);
    }
  });

  ipcMain.handle('llm:stopOllama', async () => {
    const { ollamaManager } = container;
    // Check if bundled Ollama is installed
    const isBundledInstalled = await ollamaManager.isInstalled();

    if (isBundledInstalled) {
      // Stop bundled Ollama
      await ollamaManager.stop();
    } else {
      // Fall back to system Ollama stop
      const { stopOllama } = await import('../../adapters/llm/ollama');
      await stopOllama();
    }
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

  // Updated for folder-based classification (Issue #54)
  ipcMain.handle('aiSort:accept', (_, emailId, appliedFolder) => {
    const id = assertPositiveInt(emailId, 'emailId');
    const folder = assertString(appliedFolder, 'appliedFolder', 50);
    // Import TRIAGE_FOLDERS for validation
    const { TRIAGE_FOLDERS } = require('../../core/domain');
    if (!TRIAGE_FOLDERS.includes(folder)) {
      throw new Error(`Invalid folder: ${folder}. Must be one of: ${TRIAGE_FOLDERS.join(', ')}`);
    }
    return useCases.acceptClassification(id, folder as import('../../core/domain').TriageFolder);
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

  // Updated for folder-based organization (Issue #54)
  ipcMain.handle('aiSort:bulkMoveToFolder', (_, emailIds, folderPath) => {
    if (!Array.isArray(emailIds)) throw new Error('emailIds must be an array');
    const ids = emailIds.map((id, i) => assertPositiveInt(id, `emailIds[${i}]`));
    const folder = assertString(folderPath, 'folderPath', 100);
    const { TRIAGE_FOLDERS } = require('../../core/domain');
    if (!TRIAGE_FOLDERS.includes(folder)) {
      throw new Error(`Invalid folder: ${folder}. Must be one of: ${TRIAGE_FOLDERS.join(', ')}`);
    }
    return useCases.bulkMoveToFolder(ids, folder as import('../../core/domain').TriageFolder);
  });

  ipcMain.handle('aiSort:classifyUnprocessed', async () => {
    checkRateLimit('aiSort:classifyUnprocessed', 5);
    const result = await useCases.classifyUnprocessed();
    // Stop Ollama after classification batch completes to free resources
    const llmConfig = config.get('llm');
    if (llmConfig.provider === 'ollama') {
      const { stopOllama } = await import('../../adapters/llm/ollama');
      await stopOllama();
    }
    return result;
  });

  // Issue #56: Reclassify email (re-run full triage on already-classified email)
  ipcMain.handle('aiSort:reclassify', async (_, emailId) => {
    checkRateLimit('aiSort:reclassify', 30);
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.reclassifyEmail(id);
  });

  // Issue #56: Get classification state for confirmation dialog
  ipcMain.handle('aiSort:getClassificationState', (_, emailId) => {
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.getClassificationState(id);
  });
}
