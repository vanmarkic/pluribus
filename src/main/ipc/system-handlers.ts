/**
 * System IPC Handlers (Database, Ollama, License)
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { Container } from '../container';
import type { LicenseState } from '../../core/domain';
import {
  assertBoolean,
  assertString,
  checkRateLimit,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupSystemHandlers(container: Container): void {
  const { useCases, deps, ollamaManager } = container;
  const { license } = deps;

  // ==========================================
  // Database Health & Recovery
  // ==========================================

  ipcMain.handle('db:checkIntegrity', async (_, full) => {
    checkRateLimit('db:checkIntegrity', 10);
    const runFull = full !== undefined ? assertBoolean(full, 'full') : false;
    return useCases.checkDatabaseIntegrity(runFull);
  });

  ipcMain.handle('db:backup', async () => {
    checkRateLimit('db:backup', 5);
    return useCases.createDatabaseBackup();
  });

  // ==========================================
  // Bundled Ollama Management
  // ==========================================

  ipcMain.handle('ollama:isInstalled', () => ollamaManager.isInstalled());

  ipcMain.handle('ollama:isRunning', () => ollamaManager.isRunning());

  ipcMain.handle('ollama:downloadBinary', async (event) => {
    checkRateLimit('ollama:downloadBinary', 2);
    await ollamaManager.downloadBinary((progress) => {
      event.sender.send('ollama:download-progress', progress);
    });
  });

  ipcMain.handle('ollama:start', async () => {
    return ollamaManager.start();
  });

  ipcMain.handle('ollama:stop', async () => {
    return ollamaManager.stop();
  });

  ipcMain.handle('ollama:listLocalModels', () => ollamaManager.listLocalModels());

  ipcMain.handle('ollama:pullModel', async (event, name) => {
    checkRateLimit('ollama:pullModel', 5);
    const modelName = assertString(name, 'name', 100);
    await ollamaManager.pullModel(modelName, (progress) => {
      event.sender.send('ollama:download-progress', progress);
    });
  });

  ipcMain.handle('ollama:deleteModel', async (_, name) => {
    const modelName = assertString(name, 'name', 100);
    return ollamaManager.deleteModel(modelName);
  });

  ipcMain.handle('ollama:getRecommendedModels', async () => {
    const { RECOMMENDED_MODELS } = await import('../../adapters/ollama-manager');
    return RECOMMENDED_MODELS;
  });

  // ==========================================
  // License Management
  // ==========================================

  ipcMain.handle('license:getState', () => {
    return license.getState();
  });

  ipcMain.handle('license:activate', async (_, key) => {
    checkRateLimit('license:activate', 10);
    const licenseKey = assertString(key, 'licenseKey', 50);
    return license.activate(licenseKey);
  });

  ipcMain.handle('license:validate', async () => {
    checkRateLimit('license:validate', 30);
    return license.validate();
  });

  ipcMain.handle('license:deactivate', async () => {
    checkRateLimit('license:deactivate', 5);
    return license.deactivate();
  });

  // Forward license state changes to renderer
  license.onStateChange((state: LicenseState) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('license:state-changed', state);
    });
  });
}
