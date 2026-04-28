/**
 * Sync Use Cases
 *
 * All use cases related to syncing mailboxes:
 * - Syncing single or all mailboxes
 * - Sync with auto-classification
 * - Awaiting reply detection
 * - Canceling sync
 */

import type { Deps, SyncResult } from '../ports';
import type { SyncOptions } from '../domain';

// Need to import classifyNewEmails from classification module (will be resolved after barrel export)
import { classifyNewEmails } from './classification-usecases';
import { shouldTrackAwaiting, markAwaiting, clearAwaitingByReply } from './awaiting-usecases';

// ============================================
// Sync Use Cases
// ============================================

export const syncMailbox = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'awaiting' | 'llmGenerator' | 'folders'>) =>
  async (accountId: number, options: SyncOptions = {}): Promise<SyncResult> => {
    const account = await deps.accounts.findById(accountId);
    if (!account) throw new Error('Account not found');

    // Get provider-specific folders for awaiting detection
    const providerFolders = deps.sync.getDefaultFolders(account.imapHost);
    const sentFolderPath = providerFolders[1]; // Second folder is Sent

    // If no specific folder is requested, sync both default folders (INBOX + Sent)
    // to ensure sent emails appear immediately after sending
    if (!options.folder) {
      const foldersToSync = providerFolders;
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

      // Process awaiting reply detection for new emails
      await processAwaitingDetection(deps, allNewEmailIds, sentFolderPath);

      await deps.accounts.updateLastSync(accountId);
      return { newCount: totalNew, newEmailIds: allNewEmailIds };
    }

    // Otherwise sync the specific folder requested
    const result = await deps.sync.sync(account, options);

    // Process awaiting reply detection for new emails
    await processAwaitingDetection(deps, result.newEmailIds, sentFolderPath);

    await deps.accounts.updateLastSync(accountId);

    return result;
  };

/**
 * Process awaiting reply detection for new emails:
 * 1. Clear awaiting status when a reply arrives (email has inReplyTo)
 * 2. Mark sent emails as awaiting reply if they expect a response
 *
 * Note: This function is optional - it gracefully skips if deps are not available
 * (for backwards compatibility with tests that don't provide all deps)
 */
async function processAwaitingDetection(
  deps: Partial<Pick<Deps, 'emails' | 'awaiting' | 'llmGenerator' | 'folders'>>,
  newEmailIds: number[],
  sentFolderPath: string
): Promise<void> {
  // Skip if required deps are not available
  if (!deps.emails || !deps.awaiting || !deps.folders) return;
  if (newEmailIds.length === 0) return;

  for (const emailId of newEmailIds) {
    try {
      const email = await deps.emails.findById(emailId);
      if (!email) continue;

      // 1. If email has inReplyTo, it's a reply - clear awaiting status on original
      if (email.inReplyTo) {
        const clearedId = await clearAwaitingByReply({ awaiting: deps.awaiting })(email.inReplyTo);
        if (clearedId) {
          console.log(`[awaiting] Cleared awaiting status for email ${clearedId} (reply received)`);
        }
      }

      // 2. If email is from Sent folder, check if it should be tracked as awaiting reply
      const folder = await deps.folders.findById(email.folderId);
      if (folder && folder.path.includes(sentFolderPath) && deps.llmGenerator) {
        // Fetch body for awaiting detection
        const body = await deps.emails.getBody(emailId);
        const textToAnalyze = body?.text || body?.html || '';

        if (textToAnalyze) {
          const shouldTrack = await shouldTrackAwaiting({ llm: deps.llmGenerator })(textToAnalyze);
          if (shouldTrack) {
            await markAwaiting({ awaiting: deps.awaiting })(emailId);
            console.log(`[awaiting] Marked email ${emailId} as awaiting reply`);
          }
        }
      }
    } catch (err) {
      // Don't fail sync if awaiting detection fails
      console.error(`[awaiting] Failed to process email ${emailId}:`, err);
    }
  }
}

export const syncAllMailboxes = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'awaiting' | 'llmGenerator' | 'folders'>) =>
  async (options: SyncOptions = {}): Promise<SyncResult> => {
    const accounts = await deps.accounts.findAll();
    let total = 0;
    const allNewEmailIds: number[] = [];

    for (const account of accounts) {
      // Get provider-specific folders for this account
      const providerFolders = deps.sync.getDefaultFolders(account.imapHost);
      const foldersToSync = options.folders || providerFolders;
      const sentFolderPath = providerFolders[1]; // Second folder is Sent
      console.log(`Syncing ${account.email} (${account.imapHost}), folders:`, foldersToSync);

      const accountNewEmailIds: number[] = [];
      for (const folder of foldersToSync) {
        try {
          console.log(`  Syncing folder: ${folder}`);
          const result = await deps.sync.sync(account, { ...options, folder });
          console.log(`  Synced ${folder}: ${result.newCount} new emails`);
          total += result.newCount;
          allNewEmailIds.push(...result.newEmailIds);
          accountNewEmailIds.push(...result.newEmailIds);
        } catch (e) {
          // Folder might not exist on this provider, continue to next
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`  Failed to sync ${folder}: ${errorMsg}`);
        }
      }

      // Process awaiting reply detection for this account's new emails
      await processAwaitingDetection(deps, accountNewEmailIds, sentFolderPath);

      await deps.accounts.updateLastSync(account.id);
    }

    return { newCount: total, newEmailIds: allNewEmailIds };
  };

export const syncWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'classifier' | 'classificationState' | 'config' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'awaiting' | 'llmGenerator'>) =>
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

export const syncAllWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'classifier' | 'classificationState' | 'config' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'awaiting' | 'llmGenerator'>) =>
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
