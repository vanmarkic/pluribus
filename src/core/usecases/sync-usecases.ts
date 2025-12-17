/**
 * Sync Use Cases
 *
 * All use cases related to syncing mailboxes:
 * - Syncing single or all mailboxes
 * - Sync with auto-classification
 * - Canceling sync
 */

import type { Deps } from '../ports';
import type { SyncOptions, SyncResult } from '../domain';

// Need to import classifyNewEmails from classification module (will be resolved after barrel export)
import { classifyNewEmails } from './classification-usecases';

// ============================================
// Sync Use Cases
// ============================================

export const syncMailbox = (deps: Pick<Deps, 'accounts' | 'sync'>) =>
  async (accountId: number, options: SyncOptions = {}): Promise<SyncResult> => {
    const account = await deps.accounts.findById(accountId);
    if (!account) throw new Error('Account not found');

    // If no specific folder is requested, sync both default folders (INBOX + Sent)
    // to ensure sent emails appear immediately after sending
    if (!options.folder) {
      const foldersToSync = deps.sync.getDefaultFolders(account.imapHost);
      let totalNew = 0;
      const allNewEmailIds: number[] = [];

      for (const folder of foldersToSync) {
        try {
          const result = await deps.sync.sync(account, { ...options, folder });
          totalNew += result.newCount;
          allNewEmailIds.push(...result.newEmailIds);
        } catch (e) {
          // Folder might not exist, continue to next
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`Failed to sync ${folder}:`, errorMsg);
        }
      }

      await deps.accounts.updateLastSync(accountId);
      return { newCount: totalNew, newEmailIds: allNewEmailIds };
    }

    // Otherwise sync the specific folder requested
    const result = await deps.sync.sync(account, options);
    await deps.accounts.updateLastSync(accountId);

    return result;
  };

export const syncAllMailboxes = (deps: Pick<Deps, 'accounts' | 'sync'>) =>
  async (options: SyncOptions = {}): Promise<SyncResult> => {
    const accounts = await deps.accounts.findAll();
    let total = 0;
    const allNewEmailIds: number[] = [];

    for (const account of accounts) {
      // Get provider-specific folders for this account
      const foldersToSync = options.folders || deps.sync.getDefaultFolders(account.imapHost);
      console.log(`Syncing ${account.email} (${account.imapHost}), folders:`, foldersToSync);

      for (const folder of foldersToSync) {
        try {
          console.log(`  Syncing folder: ${folder}`);
          const result = await deps.sync.sync(account, { ...options, folder });
          console.log(`  Synced ${folder}: ${result.newCount} new emails`);
          total += result.newCount;
          allNewEmailIds.push(...result.newEmailIds);
        } catch (e) {
          // Folder might not exist on this provider, continue to next
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`  Failed to sync ${folder}: ${errorMsg}`);
        }
      }
      await deps.accounts.updateLastSync(account.id);
    }

    return { newCount: total, newEmailIds: allNewEmailIds };
  };

export const syncWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'classifier' | 'classificationState' | 'config' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps'>) =>
  async (accountId: number, options: SyncOptions = {}): Promise<SyncResult & { classified?: number; skipped?: number; triaged?: number }> => {
    // First, sync the mailbox
    const syncResult = await syncMailbox(deps)(accountId, options);

    // Check if auto-classify is enabled
    const llmConfig = deps.config.getLLMConfig();
    if (!llmConfig.autoClassify || syncResult.newEmailIds.length === 0) {
      return syncResult;
    }

    // Ensure triage folders exist before classification (prevents moveMessage failures)
    const account = await deps.accounts.findById(accountId);
    if (account) {
      try {
        await deps.imapFolderOps.ensureTriageFolders(account);
      } catch (e) {
        console.warn('Failed to ensure triage folders:', e);
        // Continue anyway - folders might already exist or user may not have training enabled
      }
    }

    // Classify and triage new emails (Issue #53: also move to triage folders)
    try {
      const classifyResult = await classifyNewEmails(deps)(
        syncResult.newEmailIds,
        llmConfig.confidenceThreshold
      );
      console.log(`Auto-classified ${classifyResult.classified} new emails, triaged ${classifyResult.triaged}, skipped ${classifyResult.skipped}`);
      return { ...syncResult, ...classifyResult };
    } catch (err) {
      console.error('Auto-classification failed:', err);
      return syncResult;
    }
  };

export const syncAllWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'classifier' | 'classificationState' | 'config' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps'>) =>
  async (options: SyncOptions = {}): Promise<SyncResult & { classified?: number; skipped?: number; triaged?: number }> => {
    // First, sync all mailboxes
    const syncResult = await syncAllMailboxes(deps)(options);

    // Check if auto-classify is enabled
    const llmConfig = deps.config.getLLMConfig();
    if (!llmConfig.autoClassify || syncResult.newEmailIds.length === 0) {
      return syncResult;
    }

    // Ensure triage folders exist for all accounts before classification
    const allAccounts = await deps.accounts.findAll();
    for (const account of allAccounts) {
      try {
        await deps.imapFolderOps.ensureTriageFolders(account);
      } catch (e) {
        console.warn(`Failed to ensure triage folders for account ${account.email}:`, e);
        // Continue anyway - folders might already exist or user may not have training enabled
      }
    }

    // Classify new emails (runs in background conceptually, but we await for result tracking)
    try {
      const classifyResult = await classifyNewEmails(deps)(
        syncResult.newEmailIds,
        llmConfig.confidenceThreshold
      );
      console.log(`Auto-classified ${classifyResult.classified} new emails, triaged ${classifyResult.triaged}, skipped ${classifyResult.skipped}`);
      return { ...syncResult, ...classifyResult };
    } catch (err) {
      console.error('Auto-classification failed:', err);
      return syncResult;
    }
  };

export const cancelSync = (deps: Pick<Deps, 'sync'>) =>
  (accountId: number): Promise<void> =>
    deps.sync.cancel(accountId);
