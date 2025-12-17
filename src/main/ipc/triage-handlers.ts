/**
 * Email Triage IPC Handlers
 */

import { ipcMain } from 'electron';
import type { Container } from '../container';
import {
  assertPositiveInt,
  assertBoolean,
  assertString,
  assertOptionalPositiveInt,
  checkRateLimit,
} from './validation';

// ==========================================
// Setup Function
// ==========================================

export function setupTriageHandlers(container: Container): void {
  const { useCases } = container;

  ipcMain.handle('triage:classify', async (_, emailId) => {
    checkRateLimit('triage:classify', 30);
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.triageEmail(id);
  });

  // Issue #53: Classify AND move email to triage folder in one operation
  ipcMain.handle('triage:classifyAndMove', async (_, emailId, options) => {
    checkRateLimit('triage:classifyAndMove', 30);
    const id = assertPositiveInt(emailId, 'emailId');
    const opts = options ? { confidenceThreshold: options.confidenceThreshold } : undefined;
    return useCases.triageAndMoveEmail(id, opts);
  });

  ipcMain.handle('triage:moveToFolder', async (_, emailId, folder) => {
    const id = assertPositiveInt(emailId, 'emailId');
    const f = assertString(folder, 'folder', 50);
    return useCases.moveEmailToTriageFolder(id, f as import('../../core/domain').TriageFolder);
  });

  ipcMain.handle('triage:learnFromCorrection', async (_, emailId, aiSuggestion, userChoice) => {
    const id = assertPositiveInt(emailId, 'emailId');
    const suggestion = assertString(aiSuggestion, 'aiSuggestion', 50);
    const choice = assertString(userChoice, 'userChoice', 50);
    return useCases.learnFromTriageCorrection(id, suggestion, choice as import('../../core/domain').TriageFolder);
  });

  ipcMain.handle('triage:snooze', async (_, emailId, untilDate, reason) => {
    const id = assertPositiveInt(emailId, 'emailId');
    const r = assertString(reason, 'reason', 20) as 'shipping' | 'waiting_reply' | 'manual';
    const until = new Date(untilDate);
    if (isNaN(until.getTime())) throw new Error('Invalid date');
    return useCases.snoozeEmail(id, until, r);
  });

  ipcMain.handle('triage:unsnooze', async (_, emailId) => {
    const id = assertPositiveInt(emailId, 'emailId');
    return useCases.unsnoozeEmail(id);
  });

  ipcMain.handle('triage:processSnoozed', async () => {
    return useCases.processSnoozedEmails();
  });

  ipcMain.handle('triage:saveTrainingExample', async (_, example) => {
    if (!example || typeof example !== 'object') throw new Error('Invalid example');
    const e = example as Record<string, unknown>;

    const validated = {
      accountId: assertPositiveInt(e.accountId, 'accountId'),
      emailId: e.emailId !== undefined && e.emailId !== null ? assertPositiveInt(e.emailId, 'emailId') : null,
      fromAddress: assertString(e.fromAddress, 'fromAddress', 200),
      fromDomain: assertString(e.fromDomain, 'fromDomain', 100),
      subject: assertString(e.subject, 'subject', 500),
      aiSuggestion: e.aiSuggestion ? assertString(e.aiSuggestion, 'aiSuggestion', 50) : null,
      userChoice: assertString(e.userChoice, 'userChoice', 50),
      wasCorrection: assertBoolean(e.wasCorrection, 'wasCorrection'),
      source: assertString(e.source, 'source', 20) as 'onboarding' | 'review_folder' | 'manual_move',
    };

    return useCases.saveTrainingExample(validated);
  });

  ipcMain.handle('triage:getTrainingExamples', async (_, accountId, limit) => {
    const id = assertPositiveInt(accountId, 'accountId');
    const l = assertOptionalPositiveInt(limit, 'limit');
    return useCases.getTrainingExamples(id, l);
  });

  ipcMain.handle('triage:ensureFolders', async (_, accountId) => {
    const id = assertPositiveInt(accountId, 'accountId');
    return useCases.ensureTriageFolders(id);
  });

  ipcMain.handle('triage:getSenderRules', async (_, accountId) => {
    const id = assertPositiveInt(accountId, 'accountId');
    return useCases.getSenderRules(id);
  });

  ipcMain.handle('triage:getLog', async (_, limit, accountId) => {
    const l = assertOptionalPositiveInt(limit, 'limit');
    const id = assertOptionalPositiveInt(accountId, 'accountId');
    return useCases.getTriageLog(l, id);
  });

  // Issue #55: Select diverse training emails for onboarding
  ipcMain.handle('triage:selectDiverseTrainingEmails', async (_, accountId, options) => {
    const id = assertPositiveInt(accountId, 'accountId');
    const validated: { maxEmails?: number; poolSize?: number } = {};
    if (options && typeof options === 'object') {
      const o = options as Record<string, unknown>;
      if (o.maxEmails !== undefined) validated.maxEmails = assertPositiveInt(o.maxEmails, 'maxEmails');
      if (o.poolSize !== undefined) validated.poolSize = assertPositiveInt(o.poolSize, 'poolSize');
    }
    return useCases.selectDiverseTrainingEmails(id, validated);
  });
}
