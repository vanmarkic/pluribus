/**
 * Config IPC Handlers
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertBoolean,
  assertString,
} from './validation';

const ALLOWED_CONFIG_KEYS = ['llm', 'ollama'] as const;
type AllowedConfigKey = (typeof ALLOWED_CONFIG_KEYS)[number];

// ==========================================
// Setup Function
// ==========================================

export function setupConfigHandlers(container: Container): void {
  const { config } = container;

  // Expose triage folders to renderer (Clean Architecture: renderer shouldn't import from core)
  ipcMain.handle('config:getTriageFolders', () => {
    const { TRIAGE_FOLDERS } = require('../../core/domain');
    return TRIAGE_FOLDERS;
  });

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
}
