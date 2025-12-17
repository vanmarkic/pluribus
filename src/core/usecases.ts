/**
 * Use Cases
 * 
 * Application logic as simple functions.
 * Each function takes deps and returns a function that does the work.
 * This is partial application / currying for DI.
 */

import type { Deps, AccountInput, SmtpConfig, EmailDraft, SendResult, SyncResult, CachedImage, RemoteImagesSetting, DraftRepo } from './ports';
import type { Email, EmailBody, Account, ListEmailsOptions, SyncOptions, Classification, ClassificationState, ClassificationStats, ClassificationFeedback, ConfusedPattern, Draft, DraftInput, ListDraftsOptions, RecentContact, TriageClassificationResult, TrainingExample, TriageFolder } from './domain';
import { extractDomain, extractSubjectPattern, DEFAULT_SYNC_DAYS } from './domain';

// ============================================
// Email Use Cases
// ============================================

export const listEmails = (deps: Pick<Deps, 'emails'>) =>
  (options: ListEmailsOptions = {}): Promise<Email[]> =>
    deps.emails.list(options);

export const getEmail = (deps: Pick<Deps, 'emails'>) =>
  (id: number): Promise<Email | null> =>
    deps.emails.findById(id);

export const getEmailBody = (deps: Pick<Deps, 'emails' | 'accounts' | 'sync'>) =>
  async (emailId: number): Promise<EmailBody> => {
    // Check cache first
    const cached = await deps.emails.getBody(emailId);
    if (cached) return cached;

    // Get email and account
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const account = await deps.accounts.findById(email.accountId);
    if (!account) throw new Error('Account not found');

    // Fetch from IMAP
    const body = await deps.sync.fetchBody(account, emailId);
    
    // Cache it
    await deps.emails.saveBody(emailId, body);
    
    return body;
  };

export const searchEmails = (deps: Pick<Deps, 'emails'>) =>
  (query: string, limit = 100, accountId?: number): Promise<Email[]> =>
    deps.emails.search(query, limit, accountId);

export const markRead = (deps: Pick<Deps, 'emails'>) =>
  (id: number, isRead: boolean): Promise<void> =>
    deps.emails.markRead(id, isRead);

export const starEmail = (deps: Pick<Deps, 'emails'>) =>
  (id: number, isStarred: boolean): Promise<void> =>
    deps.emails.setStar(id, isStarred);

// Archive/unarchive now use folders (Issue #54)
export const archiveEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'folders' | 'imapFolderOps'>) =>
  async (emailId: number): Promise<void> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const currentFolder = await deps.folders.findById(email.folderId);
    if (!currentFolder) throw new Error('Folder not found');

    const account = await deps.accounts.findById(email.accountId);
    if (!account) throw new Error('Account not found');

    // Move to Archive folder via IMAP
    await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, 'Archive');

    // Update local DB
    const archiveFolder = await deps.folders.getOrCreate(email.accountId, 'Archive', 'Archive');
    await deps.emails.setFolderId(emailId, archiveFolder.id);
  };

export const unarchiveEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'folders' | 'imapFolderOps'>) =>
  async (emailId: number): Promise<void> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const currentFolder = await deps.folders.findById(email.folderId);
    if (!currentFolder) throw new Error('Folder not found');

    const account = await deps.accounts.findById(email.accountId);
    if (!account) throw new Error('Account not found');

    // Move back to INBOX via IMAP
    await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, 'INBOX');

    // Update local DB
    const inboxFolder = await deps.folders.getOrCreate(email.accountId, 'INBOX', 'INBOX');
    await deps.emails.setFolderId(emailId, inboxFolder.id);
  };

export const deleteEmail = (deps: Pick<Deps, 'emails' | 'imageCache'>) =>
  async (id: number): Promise<void> => {
    // Clear cached image files (DB cascade handles email_images_loaded table)
    await deps.imageCache.clearCacheFiles(id);
    await deps.emails.delete(id);
  };

export const trashEmail = (deps: Pick<Deps, 'emails' | 'folders' | 'accounts' | 'imapFolderOps'>) =>
  async (emailId: number): Promise<void> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const currentFolder = await deps.folders.findById(email.folderId);
    if (!currentFolder) throw new Error('Folder not found');

    const account = await deps.accounts.findById(email.accountId);
    if (!account) throw new Error('Account not found');

    // Move to Trash via IMAP (returns the trash folder path used)
    const trashPath = await deps.imapFolderOps.moveToTrash(account, email.uid, currentFolder.path);

    // Update local DB to reflect the new folder
    const trashFolder = await deps.folders.getOrCreate(email.accountId, trashPath, 'Trash');
    await deps.emails.setFolderId(emailId, trashFolder.id);
  };

// Tag use cases removed - using folders for organization (Issue #54)

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

// ============================================
// Classification Use Cases
// ============================================

// Classification now uses folders instead of tags (Issue #54)
export const classifyEmail = (deps: Pick<Deps, 'emails' | 'classifier'>) =>
  async (emailId: number): Promise<Classification> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const body = await deps.emails.getBody(emailId);

    return deps.classifier.classify(email, body || undefined);
  };

export const classifyAndApply = (deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState'>) =>
  async (emailId: number, confidenceThreshold = 0.85): Promise<Classification> => {
    const result = await classifyEmail(deps)(emailId);

    // Determine status based on confidence threshold
    const status = result.confidence >= confidenceThreshold ? 'classified' : 'pending_review';

    // Save classification state (clear dismissed_at if re-classifying)
    await deps.classificationState.setState({
      emailId,
      status,
      confidence: result.confidence,
      priority: result.priority,
      suggestedFolder: result.suggestedFolder,
      reasoning: result.reasoning,
      classifiedAt: new Date(),
      dismissedAt: null,  // Clear dismissed timestamp on re-classification
      errorMessage: null, // Clear any previous error
    });

    return result;
  };

/**
 * Classify and triage email (Issue #53, Issue #54)
 *
 * Folder-based classification and triage.
 * After classification, emails are moved to appropriate triage folders.
 */
export const classifyAndTriage = (deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps'>) =>
  async (emailId: number, confidenceThreshold = 0.85): Promise<{ classification: Classification; triage: TriageClassificationResult }> => {
    // Step 1: Classification (folder-based)
    const classification = await classifyAndApply(deps)(emailId, confidenceThreshold);

    // Step 2: Folder-based triage
    const triage = await triageAndMoveEmail(deps)(emailId, { confidenceThreshold: 0.7 });

    return { classification, triage };
  };

/**
 * Classify new emails using the unified triage system (Refactored - Issue #55/#56)
 *
 * BEFORE: Called both classifyAndApply() and triageAndMoveEmail() - two LLM calls per email
 * AFTER: Uses only triageAndMoveEmail() and syncs state to classificationState
 *
 * This consolidation:
 * - Halves LLM API costs
 * - Uses pattern matching + training examples (triage system)
 * - Keeps classificationState in sync for ReviewQueue UI
 */
export const classifyNewEmails = (deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config'>) =>
  async (emailIds: number[], confidenceThreshold = 0.85): Promise<{ classified: number; skipped: number; triaged: number }> => {
    const budget = deps.classifier.getEmailBudget();

    // Check budget - limit=0 means unlimited (Ollama)
    if (budget.limit > 0 && budget.used >= budget.limit) {
      console.log('Daily email classification budget exhausted');
      return { classified: 0, skipped: emailIds.length, triaged: 0 };
    }

    // Fetch emails to sort by date (most recent first)
    const emails = await Promise.all(
      emailIds.map(id => deps.emails.findById(id))
    );

    // Sort by date descending (most recent first), filter out nulls
    const sortedEmails = emails
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Limit to remaining budget (prioritizing most recent), unlimited if limit=0
    const remainingBudget = budget.limit > 0 ? budget.limit - budget.used : sortedEmails.length;
    const emailsToClassify = sortedEmails.slice(0, remainingBudget);
    const skipped = emailIds.length - emailsToClassify.length;

    let classified = 0;
    let triaged = 0;

    for (const email of emailsToClassify) {
      try {
        // Use unified triage system (pattern matching + training + LLM + folder move)
        // This replaces the old dual-call pattern
        const triageResult = await triageAndMoveEmail(deps)(email.id, {
          confidenceThreshold: Math.min(confidenceThreshold, 0.7), // Use lower of the two thresholds
        });

        // Sync triage result to classificationState for ReviewQueue UI
        const status = triageResult.confidence >= confidenceThreshold
          ? 'classified'
          : 'pending_review';

        await deps.classificationState.setState({
          emailId: email.id,
          status,
          confidence: triageResult.confidence,
          priority: triageResult.confidence >= 0.9 ? 'high' : triageResult.confidence >= 0.7 ? 'normal' : 'low',
          suggestedFolder: triageResult.folder,
          reasoning: triageResult.reasoning,
          classifiedAt: new Date(),
          errorMessage: null,
        });

        classified++;
        triaged++;
      } catch (error) {
        console.error(`Failed to classify email ${email.id}:`, error);
        // Record error state so user can retry
        await deps.classificationState.setState({
          emailId: email.id,
          status: 'error',
          confidence: null,
          priority: null,
          suggestedFolder: null,
          reasoning: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          classifiedAt: new Date(),
        });
      }
    }

    return { classified, skipped, triaged };
  };

// ============================================
// LLM Provider Use Cases
// ============================================

export const validateLLMProvider = (deps: Pick<Deps, 'llmProvider'>) =>
  (key: string): Promise<{ valid: boolean; error?: string }> =>
    deps.llmProvider.validateKey(key);

export const listLLMModels = (deps: Pick<Deps, 'llmProvider'>) =>
  (): Promise<import('./ports').LLMModel[]> =>
    deps.llmProvider.listModels();

export const testLLMConnection = (deps: Pick<Deps, 'llmProvider'>) =>
  async (): Promise<{ connected: boolean; error?: string }> => {
    if (deps.llmProvider.testConnection) {
      return deps.llmProvider.testConnection();
    }
    return { connected: true };
  };

export const isLLMConfigured = (deps: Pick<Deps, 'llmProvider' | 'config' | 'secrets'>) =>
  async (): Promise<{ configured: boolean; reason?: string }> => {
    const config = deps.config.getLLMConfig();

    if (config.provider === 'anthropic') {
      // Anthropic: needs API key that validates
      const key = await deps.secrets.getApiKey('anthropic');
      if (!key) {
        return { configured: false, reason: 'No API key configured' };
      }
      const result = await deps.llmProvider.validateKey(key);
      return result.valid
        ? { configured: true }
        : { configured: false, reason: result.error || 'Invalid API key' };
    }

    // Ollama: needs server reachable + at least one model
    if (!deps.llmProvider.testConnection) {
      return { configured: false, reason: 'Provider does not support connection test' };
    }
    const conn = await deps.llmProvider.testConnection();
    if (!conn.connected) {
      return { configured: false, reason: conn.error || 'Ollama server not reachable' };
    }
    const models = await deps.llmProvider.listModels();
    if (models.length === 0) {
      return { configured: false, reason: 'No models installed in Ollama' };
    }
    return { configured: true };
  };

export const startBackgroundClassification = (deps: Pick<Deps, 'backgroundTasks' | 'emails' | 'classifier' | 'classificationState' | 'config'>) =>
  (emailIds: number[]): { taskId: string; count: number } => {
    const taskId = crypto.randomUUID();
    const llmConfig = deps.config.getLLMConfig();
    const threshold = llmConfig.confidenceThreshold;

    // Determine concurrency: use configured value, or default based on provider
    // Ollama (local) can handle 2-3 parallel requests; Anthropic should be sequential (rate limited)
    const concurrency = llmConfig.classificationConcurrency ??
      (llmConfig.provider === 'ollama' ? 2 : 1);

    deps.backgroundTasks.start(taskId, emailIds.length, async (onProgress) => {
      // Process emails with controlled concurrency
      const processEmail = async (emailId: number): Promise<void> => {
        // Check budget before each classification
        const budget = deps.classifier.getEmailBudget();
        if (!budget.allowed) {
          console.log(`Daily budget exhausted, skipping email ${emailId}`);
          onProgress();
          return;
        }

        try {
          await classifyAndApply(deps)(emailId, threshold);
        } catch (error) {
          console.error(`Background classification failed for email ${emailId}:`, error);
          await deps.classificationState.setState({
            emailId,
            status: 'error',
            confidence: null,
            priority: null,
            suggestedFolder: null,
            reasoning: null,
            errorMessage: error instanceof Error ? error.message : String(error),
            classifiedAt: new Date(),
          });
        }
        onProgress();
      };

      if (concurrency <= 1) {
        // Sequential processing
        for (const emailId of emailIds) {
          await processEmail(emailId);
        }
      } else {
        // Parallel processing with concurrency limit
        const queue = [...emailIds];
        const inFlight: Promise<void>[] = [];

        while (queue.length > 0 || inFlight.length > 0) {
          // Fill up to concurrency limit
          while (queue.length > 0 && inFlight.length < concurrency) {
            const emailId = queue.shift()!;
            const promise = processEmail(emailId).then(() => {
              // Remove from inFlight when done
              const idx = inFlight.indexOf(promise);
              if (idx !== -1) inFlight.splice(idx, 1);
            });
            inFlight.push(promise);
          }

          // Wait for at least one to complete before continuing
          if (inFlight.length > 0) {
            await Promise.race(inFlight);
          }
        }
      }
    });

    return { taskId, count: emailIds.length };
  };

export const getBackgroundTaskStatus = (deps: Pick<Deps, 'backgroundTasks'>) =>
  (taskId: string): import('./ports').TaskState | null => {
    return deps.backgroundTasks.getStatus(taskId);
  };

export const clearBackgroundTask = (deps: Pick<Deps, 'backgroundTasks'>) =>
  (taskId: string): void => {
    deps.backgroundTasks.clear(taskId);
  };

// ============================================
// AI Sort Use Cases
// ============================================

export type PendingReviewOptions = {
  limit?: number;
  offset?: number;
  sortBy?: 'confidence' | 'date' | 'sender';
};

export type PendingReviewItem = ClassificationState & {
  email: Email;
};

export const getPendingReviewQueue = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (options: PendingReviewOptions = {}): Promise<PendingReviewItem[]> => {
    const states = await deps.classificationState.listPendingReview(options);

    const items: PendingReviewItem[] = [];
    for (const state of states) {
      const email = await deps.emails.findById(state.emailId);
      if (email) {
        items.push({ ...state, email });
      }
    }

    return items;
  };

export const getEmailsByPriority = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (priority: 'high' | 'normal' | 'low', options: { limit?: number; offset?: number } = {}): Promise<PendingReviewItem[]> => {
    const states = await deps.classificationState.listByPriority(priority, options);

    const items: PendingReviewItem[] = [];
    for (const state of states) {
      const email = await deps.emails.findById(state.emailId);
      if (email) {
        items.push({ ...state, email });
      }
    }

    return items;
  };

export const getFailedClassifications = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (options: { limit?: number; offset?: number } = {}): Promise<PendingReviewItem[]> => {
    const states = await deps.classificationState.listFailed(options);

    const items: PendingReviewItem[] = [];
    for (const state of states) {
      const email = await deps.emails.findById(state.emailId);
      if (email) {
        items.push({ ...state, email });
      }
    }

    return items;
  };

export const getClassificationStats = (deps: Pick<Deps, 'classificationState' | 'config' | 'classifier'>) =>
  async (accountId?: number): Promise<ClassificationStats> => {
    const stats = await deps.classificationState.getStats(accountId);
    const budget = deps.classifier.getEmailBudget();

    return {
      ...stats,
      budgetUsed: budget.used,
      budgetLimit: budget.limit,
    };
  };

// Accept classification now uses folders (Issue #54)
export const acceptClassification = (deps: Pick<Deps, 'classificationState' | 'emails' | 'accounts' | 'folders' | 'imapFolderOps'>) =>
  async (emailId: number, appliedFolder: TriageFolder): Promise<void> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state) throw new Error('Classification state not found');

    // Determine if folder was edited
    const isExactMatch = state.suggestedFolder === appliedFolder;
    const action = isExactMatch ? 'accept' : 'accept_edit';
    const accuracyScore = isExactMatch ? 1.0 : 0.98;

    // Log feedback
    await deps.classificationState.logFeedback({
      emailId,
      action,
      originalFolder: state.suggestedFolder,
      finalFolder: appliedFolder,
      accuracyScore,
    });

    // Update state
    await deps.classificationState.setState({
      ...state,
      status: 'accepted',
      reviewedAt: new Date(),
    });

    // Move email to the applied folder
    const email = await deps.emails.findById(emailId);
    if (email) {
      const currentFolder = await deps.folders.findById(email.folderId);
      if (currentFolder && currentFolder.path !== appliedFolder) {
        const account = await deps.accounts.findById(email.accountId);
        if (account) {
          await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, appliedFolder);
          const newFolder = await deps.folders.getOrCreate(email.accountId, appliedFolder, appliedFolder);
          await deps.emails.setFolderId(emailId, newFolder.id);
        }
      }
    }
  };

export const dismissClassification = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (emailId: number): Promise<void> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state) throw new Error('Classification state not found');

    const email = await deps.emails.findById(emailId);

    // Log feedback
    await deps.classificationState.logFeedback({
      emailId,
      action: 'dismiss',
      originalFolder: state.suggestedFolder,
      finalFolder: null,
      accuracyScore: 0.0,
    });

    // Update state
    await deps.classificationState.setState({
      ...state,
      status: 'dismissed',
      dismissedAt: new Date(),
    });

    // Update confused patterns
    if (email) {
      // Track sender domain pattern
      const domain = extractDomain(email.from.address);
      await deps.classificationState.updateConfusedPattern(
        'sender_domain',
        domain,
        state.confidence ?? 0
      );

      // Track subject pattern if detected
      const subjectPattern = extractSubjectPattern(email.subject);
      if (subjectPattern) {
        await deps.classificationState.updateConfusedPattern(
          'subject_pattern',
          subjectPattern,
          state.confidence ?? 0
        );
      }
    }
  };

export const retryClassification = (deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'config'>) =>
  async (emailId: number): Promise<Classification> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state || state.status !== 'error') {
      throw new Error('Email is not in error state');
    }

    const llmConfig = deps.config.getLLMConfig();
    return classifyAndApply(deps)(emailId, llmConfig.confidenceThreshold);
  };

/**
 * Reclassify an already-classified email (Issue #56)
 *
 * Uses the full triage system (pattern matching + training examples + LLM)
 * and moves the email to the new folder. Works on any email regardless of
 * current classification status.
 *
 * @param emailId - The email to reclassify
 * @returns Previous and new classification info for confirmation UI
 */
export const reclassifyEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'folders' | 'classificationState' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps' | 'config' | 'classifier'>) =>
  async (emailId: number): Promise<{
    previousFolder: TriageFolder | null;
    previousConfidence: number | null;
    newFolder: TriageFolder;
    newConfidence: number;
    reasoning: string;
  }> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    // Check budget before LLM call
    const budget = deps.classifier.getEmailBudget();
    if (budget.limit > 0 && budget.used >= budget.limit) {
      throw new Error('Daily classification budget exhausted. Try again tomorrow.');
    }

    // Capture previous state for UI feedback
    const previousState = await deps.classificationState.getState(emailId);
    const previousFolder = previousState?.suggestedFolder ?? null;
    const previousConfidence = previousState?.confidence ?? null;

    // Clear existing state to allow fresh classification
    // This resets dismissed_at so reclassified emails re-enter the review queue
    if (previousState) {
      await deps.classificationState.setState({
        ...previousState,
        status: 'unprocessed',
        confidence: null,
        priority: null,
        suggestedFolder: null,
        reasoning: null,
        classifiedAt: null,
        reviewedAt: null,
        dismissedAt: null,
        errorMessage: null,
      });
    }

    // Run full triage classification (pattern + training + LLM + move)
    const llmConfig = deps.config.getLLMConfig();
    const triageResult = await triageAndMoveEmail(deps)(emailId, {
      confidenceThreshold: llmConfig.confidenceThreshold,
    });

    // Update classification state with triage results
    const newStatus = triageResult.confidence >= llmConfig.confidenceThreshold
      ? 'classified'
      : 'pending_review';

    await deps.classificationState.setState({
      emailId,
      status: newStatus,
      confidence: triageResult.confidence,
      priority: triageResult.confidence >= 0.9 ? 'high' : triageResult.confidence >= 0.7 ? 'normal' : 'low',
      suggestedFolder: triageResult.folder,
      reasoning: triageResult.reasoning,
      classifiedAt: new Date(),
      dismissedAt: null,
      errorMessage: null,
    });

    // Log feedback for learning (reclassification is implicit correction if folder changed)
    if (previousFolder && previousFolder !== triageResult.folder) {
      await deps.classificationState.logFeedback({
        emailId,
        action: 'reclassify',
        originalFolder: previousFolder,
        finalFolder: triageResult.folder,
        accuracyScore: 0.5, // Reclassification = uncertain about previous
      });
    }

    return {
      previousFolder,
      previousConfidence,
      newFolder: triageResult.folder,
      newConfidence: triageResult.confidence,
      reasoning: triageResult.reasoning,
    };
  };

/**
 * Get classification state for an email (for confirmation dialog)
 */
export const getClassificationState = (deps: Pick<Deps, 'classificationState'>) =>
  async (emailId: number): Promise<ClassificationState | null> => {
    return deps.classificationState.getState(emailId);
  };

export const getConfusedPatterns = (deps: Pick<Deps, 'classificationState'>) =>
  (limit = 5, accountId?: number): Promise<ConfusedPattern[]> =>
    deps.classificationState.listConfusedPatterns(limit, accountId);

export const clearConfusedPatterns = (deps: Pick<Deps, 'classificationState'>) =>
  (): Promise<void> =>
    deps.classificationState.clearConfusedPatterns();

export const getRecentActivity = (deps: Pick<Deps, 'classificationState'>) =>
  (limit = 10, accountId?: number): Promise<ClassificationFeedback[]> =>
    deps.classificationState.listRecentFeedback(limit, accountId);

// Bulk move to folder (Issue #54 - replaces bulkApplyTag)
export const bulkMoveToFolder = (deps: Pick<Deps, 'classificationState' | 'emails' | 'accounts' | 'folders' | 'imapFolderOps'>) =>
  async (emailIds: number[], folder: TriageFolder): Promise<{ applied: number; failed: number }> => {
    let applied = 0;
    let failed = 0;

    for (const emailId of emailIds) {
      try {
        const state = await deps.classificationState.getState(emailId);
        if (!state || state.status !== 'pending_review') {
          failed++;
          continue;
        }

        // Log feedback as accept_edit (user chose different folder)
        await deps.classificationState.logFeedback({
          emailId,
          action: 'accept_edit',
          originalFolder: state.suggestedFolder,
          finalFolder: folder,
          accuracyScore: 0.98,
        });

        // Update state
        await deps.classificationState.setState({
          ...state,
          status: 'accepted',
          reviewedAt: new Date(),
        });

        // Move to the chosen folder
        const email = await deps.emails.findById(emailId);
        if (email) {
          const currentFolder = await deps.folders.findById(email.folderId);
          if (currentFolder && currentFolder.path !== folder) {
            const account = await deps.accounts.findById(email.accountId);
            if (account) {
              await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, folder);
              const newFolder = await deps.folders.getOrCreate(email.accountId, folder, folder);
              await deps.emails.setFolderId(emailId, newFolder.id);
            }
          }
        }

        applied++;
      } catch {
        failed++;
      }
    }

    return { applied, failed };
  };

export const bulkAcceptClassifications = (deps: Pick<Deps, 'classificationState' | 'emails' | 'accounts' | 'folders' | 'imapFolderOps'>) =>
  async (emailIds: number[]): Promise<{ accepted: number; failed: number }> => {
    let accepted = 0;
    let failed = 0;

    for (const emailId of emailIds) {
      try {
        const state = await deps.classificationState.getState(emailId);
        if (!state || state.status !== 'pending_review') {
          failed++;
          continue;
        }

        // Log feedback as accept (no edits)
        await deps.classificationState.logFeedback({
          emailId,
          action: 'accept',
          originalFolder: state.suggestedFolder,
          finalFolder: state.suggestedFolder,
          accuracyScore: 1.0,
        });

        // Update state
        await deps.classificationState.setState({
          ...state,
          status: 'accepted',
          reviewedAt: new Date(),
        });

        // Move to the suggested folder
        if (state.suggestedFolder) {
          const email = await deps.emails.findById(emailId);
          if (email) {
            const currentFolder = await deps.folders.findById(email.folderId);
            if (currentFolder && currentFolder.path !== state.suggestedFolder) {
              const account = await deps.accounts.findById(email.accountId);
              if (account) {
                await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, state.suggestedFolder);
                const newFolder = await deps.folders.getOrCreate(email.accountId, state.suggestedFolder, state.suggestedFolder);
                await deps.emails.setFolderId(emailId, newFolder.id);
              }
            }
          }
        }

        accepted++;
      } catch {
        failed++;
      }
    }

    return { accepted, failed };
  };

export const bulkDismissClassifications = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (emailIds: number[]): Promise<{ dismissed: number; failed: number }> => {
    let dismissed = 0;
    let failed = 0;

    for (const emailId of emailIds) {
      try {
        const state = await deps.classificationState.getState(emailId);
        if (!state || state.status !== 'pending_review') {
          failed++;
          continue;
        }

        const email = await deps.emails.findById(emailId);

        // Log feedback (using folders now - Issue #54)
        await deps.classificationState.logFeedback({
          emailId,
          action: 'dismiss',
          originalFolder: state.suggestedFolder,
          finalFolder: null,
          accuracyScore: 0.0,
        });

        // Update state
        await deps.classificationState.setState({
          ...state,
          status: 'dismissed',
          dismissedAt: new Date(),
        });

        // Update confused patterns
        if (email) {
          // Track sender domain pattern
          const domain = extractDomain(email.from.address);
          await deps.classificationState.updateConfusedPattern(
            'sender_domain',
            domain,
            state.confidence ?? 0
          );

          // Track subject pattern if detected
          const subjectPattern = extractSubjectPattern(email.subject);
          if (subjectPattern) {
            await deps.classificationState.updateConfusedPattern(
              'subject_pattern',
              subjectPattern,
              state.confidence ?? 0
            );
          }
        }

        dismissed++;
      } catch {
        failed++;
      }
    }

    return { dismissed, failed };
  };

export const getPendingReviewCount = (deps: Pick<Deps, 'classificationState'>) =>
  async (): Promise<number> => {
    const counts = await deps.classificationState.countByStatus();
    return counts.pending_review;
  };

export const classifyUnprocessed = (deps: Pick<Deps, 'emails' | 'classifier' | 'classificationState' | 'config' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps'>) =>
  async (): Promise<{ classified: number; skipped: number }> => {
    const llmConfig = deps.config.getLLMConfig();

    // Get emails without classification state (truly unprocessed)
    const allEmails = await deps.emails.list({ limit: 1000 });
    const unprocessedIds: number[] = [];

    for (const email of allEmails) {
      const state = await deps.classificationState.getState(email.id);
      if (!state) {
        unprocessedIds.push(email.id);
      }
    }

    // Get reclassifiable dismissed emails (past cooldown)
    // -1 means "never" - don't auto-reclassify dismissed emails
    let reclassifiableIds: number[] = [];
    if (llmConfig.reclassifyCooldownDays >= 0) {
      reclassifiableIds = await deps.classificationState.listReclassifiable(
        llmConfig.reclassifyCooldownDays
      );
    }

    // Combine and dedupe
    const emailIds = [...new Set([...unprocessedIds, ...reclassifiableIds])];

    if (emailIds.length === 0) {
      return { classified: 0, skipped: 0 };
    }

    // Use existing classifyNewEmails logic
    return classifyNewEmails(deps)(emailIds, llmConfig.confidenceThreshold);
  };

// ============================================
// Account Use Cases
// ============================================

export const listAccounts = (deps: Pick<Deps, 'accounts'>) =>
  (): Promise<Account[]> =>
    deps.accounts.findAll();

export const getAccount = (deps: Pick<Deps, 'accounts'>) =>
  (id: number): Promise<Account | null> =>
    deps.accounts.findById(id);

export const createAccount = (deps: Pick<Deps, 'accounts' | 'secrets'>) =>
  async (account: AccountInput, password: string): Promise<Account> => {
    // Check if account already exists
    const existing = await deps.accounts.findByEmail(account.email);
    if (existing) throw new Error('Account already exists');
    
    // Store password securely first
    await deps.secrets.setPassword(account.email, password);
    
    // Then create account record
    return deps.accounts.create(account);
  };

export const updateAccount = (deps: Pick<Deps, 'accounts' | 'secrets'>) =>
  async (id: number, updates: Partial<AccountInput>, newPassword?: string): Promise<Account> => {
    const account = await deps.accounts.findById(id);
    if (!account) throw new Error('Account not found');
    
    // Update password if provided
    if (newPassword) {
      await deps.secrets.setPassword(account.email, newPassword);
    }
    
    return deps.accounts.update(id, updates);
  };

export const deleteAccount = (deps: Pick<Deps, 'accounts' | 'secrets' | 'sync'>) =>
  async (id: number): Promise<void> => {
    const account = await deps.accounts.findById(id);
    if (!account) throw new Error('Account not found');

    // Disconnect IMAP
    await deps.sync.disconnect(id);

    // Delete password
    await deps.secrets.deletePassword(account.email);

    // Soft-delete account
    await deps.accounts.delete(id);
  };

export type AddAccountOptions = {
  skipSync?: boolean;
};

export type AddAccountResult = {
  account: Account;
  syncResult: SyncResult;
  /** Number of days synced - UI can display "Downloaded emails from the last 30 days" */
  syncDays: number;
};

export const addAccount = (deps: Pick<Deps, 'accounts' | 'secrets' | 'sync'>) =>
  async (account: AccountInput, password: string, options: AddAccountOptions = {}): Promise<AddAccountResult> => {
    const { skipSync = false } = options;

    // Check if account already exists
    const existing = await deps.accounts.findByEmail(account.email);
    if (existing) throw new Error('Account already exists');

    // Store password securely first
    await deps.secrets.setPassword(account.email, password);

    // Then create account record
    const createdAccount = await deps.accounts.create(account);

    // Skip sync if requested
    if (skipSync) {
      return {
        account: createdAccount,
        syncResult: { newCount: 0, newEmailIds: [] },
        syncDays: DEFAULT_SYNC_DAYS,
      };
    }

    // Perform initial sync for provider-specific folders with date-based filter
    const foldersToSync = deps.sync.getDefaultFolders(account.imapHost);
    const since = new Date(Date.now() - DEFAULT_SYNC_DAYS * 24 * 60 * 60 * 1000);
    let totalNewCount = 0;
    const allNewEmailIds: number[] = [];

    for (const folder of foldersToSync) {
      try {
        const result = await deps.sync.sync(createdAccount, { folder, since });
        totalNewCount += result.newCount;
        allNewEmailIds.push(...result.newEmailIds);
      } catch (e) {
        // Folder might not exist on this provider, continue to next
        const errorMsg = e instanceof Error ? e.message : String(e);
        if (!errorMsg.includes('NONEXISTENT') && !errorMsg.includes('does not exist')) {
          console.error(`Failed to sync ${account.email}/${folder}:`, e);
        }
      }
    }

    return {
      account: createdAccount,
      syncResult: { newCount: totalNewCount, newEmailIds: allNewEmailIds },
      syncDays: DEFAULT_SYNC_DAYS,
    };
  };

export const testImapConnection = (deps: Pick<Deps, 'sync' | 'secrets'>) =>
  async (email: string, imapHost: string, imapPort: number): Promise<{ ok: boolean; error?: string }> => {
    // Get password from secure storage
    const password = await deps.secrets.getPassword(email);
    if (!password) {
      return { ok: false, error: 'No password stored for this account' };
    }

    // Test connection without any database operations
    return deps.sync.testConnection(imapHost, imapPort, email, password);
  };

export const testSmtpConnection = (deps: Pick<Deps, 'sender'>) =>
  (email: string, smtpConfig: SmtpConfig): Promise<{ ok: boolean; error?: string }> =>
    deps.sender.testConnection(smtpConfig, email);

// ============================================
// Send Use Cases
// ============================================

export const sendEmail = (deps: Pick<Deps, 'accounts' | 'sender' | 'secrets' | 'sync'>) =>
  async (accountId: number, draft: EmailDraft): Promise<SendResult> => {
    const account = await deps.accounts.findById(accountId);
    if (!account) throw new Error('Account not found');

    // Check if biometric required for send
    const securityConfig = deps.secrets.getConfig();
    if (securityConfig.requireForSend) {
      // This will trigger biometric prompt via the secrets adapter
      const password = await deps.secrets.getPassword(account.email);
      if (!password) throw new Error('Authentication required');
    }

    const smtpConfig: SmtpConfig = {
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpPort === 465,
    };

    const result = await deps.sender.send(account.email, smtpConfig, draft);

    // Append to Sent folder via IMAP (best effort - don't fail if this fails)
    try {
      await deps.sync.appendToSent(account, {
        from: account.email,
        ...draft,
      });
    } catch (err) {
      console.warn('Failed to append to Sent folder:', err);
    }

    return result;
  };

export const replyToEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'sender' | 'secrets' | 'sync'>) =>
  async (emailId: number, body: { text?: string; html?: string }, replyAll = false): Promise<SendResult> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const account = await deps.accounts.findById(email.accountId);
    if (!account) throw new Error('Account not found');

    // Build reply recipients
    const to = [email.from.address];
    const cc = replyAll ? email.to.filter(addr => addr !== account.email) : [];

    const draft: EmailDraft = {
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      text: body.text,
      html: body.html,
      inReplyTo: email.messageId,
      references: [email.messageId],
    };

    return sendEmail(deps)(email.accountId, draft);
  };

export const forwardEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'sender' | 'secrets' | 'sync'>) =>
  async (emailId: number, to: string[], body: { text?: string; html?: string }): Promise<SendResult> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const draft: EmailDraft = {
      to,
      subject: email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
      text: body.text,
      html: body.html,
    };

    return sendEmail(deps)(email.accountId, draft);
  };

// ============================================
// Remote Images Use Cases
// ============================================

export const loadRemoteImages = (deps: Pick<Deps, 'emails' | 'imageCache'>) =>
  async (emailId: number, urls: string[]): Promise<CachedImage[]> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    // Check if already loaded
    const alreadyLoaded = await deps.imageCache.hasLoadedImages(emailId);
    if (alreadyLoaded) {
      return deps.imageCache.getCachedImages(emailId);
    }

    // Fetch and cache images
    const cached = await deps.imageCache.cacheImages(emailId, urls);
    await deps.imageCache.markImagesLoaded(emailId);

    return cached;
  };

export const hasLoadedRemoteImages = (deps: Pick<Deps, 'imageCache'>) =>
  (emailId: number): Promise<boolean> =>
    deps.imageCache.hasLoadedImages(emailId);

export const getRemoteImagesSetting = (deps: Pick<Deps, 'config'>) =>
  (): RemoteImagesSetting =>
    deps.config.getRemoteImagesSetting();

export const setRemoteImagesSetting = (deps: Pick<Deps, 'config'>) =>
  (setting: RemoteImagesSetting): void =>
    deps.config.setRemoteImagesSetting(setting);

export const clearImageCache = (deps: Pick<Deps, 'imageCache'>) =>
  (emailId: number): Promise<void> =>
    deps.imageCache.clearCache(emailId);

export const clearAllImageCache = (deps: Pick<Deps, 'imageCache'>) =>
  (): Promise<void> =>
    deps.imageCache.clearAllCache();

export const autoLoadImagesForEmail = (deps: Pick<Deps, 'config' | 'imageCache'>) =>
  async (emailId: number, blockedUrls: string[]): Promise<CachedImage[]> => {
    // Check setting - block means no auto-load
    const setting = deps.config.getRemoteImagesSetting();
    if (setting === 'block') {
      return [];
    }

    // Check if already loaded
    const alreadyLoaded = await deps.imageCache.hasLoadedImages(emailId);
    if (alreadyLoaded) {
      return deps.imageCache.getCachedImages(emailId);
    }

    // For 'auto' or 'allow', fetch and cache
    if (blockedUrls.length === 0) {
      return [];
    }

    const cached = await deps.imageCache.cacheImages(emailId, blockedUrls);
    await deps.imageCache.markImagesLoaded(emailId);
    return cached;
  };

// ============================================
// Contact Use Cases
// ============================================

export const getRecentContacts = (deps: Pick<Deps, 'contacts'>) =>
  (limit?: number): Promise<RecentContact[]> =>
    deps.contacts.getRecent(limit);

export const searchContacts = (deps: Pick<Deps, 'contacts'>) =>
  (query: string, limit?: number): Promise<RecentContact[]> =>
    deps.contacts.search(query, limit);

export const recordContactUsage = (deps: Pick<Deps, 'contacts'>) =>
  (addresses: string[]): Promise<void> =>
    deps.contacts.recordUsage(addresses);

// ============================================
// Draft Use Cases
// ============================================

export const saveDraft = (deps: Pick<Deps, 'drafts'>) =>
  async (input: DraftInput): Promise<Draft> => {
    // If id provided, check if draft exists to update
    if (input.id) {
      const existing = await deps.drafts.findById(input.id);
      if (existing) {
        return deps.drafts.update(input.id, input);
      }
    }
    // Otherwise save as new
    return deps.drafts.save(input);
  };

export const getDraft = (deps: Pick<Deps, 'drafts'>) =>
  (id: number): Promise<Draft | null> =>
    deps.drafts.findById(id);

export const listDrafts = (deps: Pick<Deps, 'drafts'>) =>
  (options: ListDraftsOptions = {}): Promise<Draft[]> =>
    deps.drafts.list(options);

export const deleteDraft = (deps: Pick<Deps, 'drafts'>) =>
  (id: number): Promise<void> =>
    deps.drafts.delete(id);

// ============================================
// Database Health & Recovery Use Cases
// ============================================

export const checkDatabaseIntegrity = (deps: Pick<Deps, 'databaseHealth'>) =>
  (full = false): Promise<import('./ports').IntegrityCheckResult> =>
    deps.databaseHealth.checkIntegrity(full);

export const createDatabaseBackup = (deps: Pick<Deps, 'databaseHealth'>) =>
  (): Promise<string> =>
    deps.databaseHealth.createBackup();

// ============================================
// Email Triage Use Cases
// ============================================

export const triageEmail = (deps: Pick<Deps, 'emails' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog'>) =>
  async (emailId: number): Promise<TriageClassificationResult> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    // Step 1: Pattern matching (fast, local)
    const patternResult = deps.patternMatcher.match(email);

    // Step 2: Get relevant training examples
    const examples = await deps.trainingRepo.getRelevantExamples(email.accountId, email, 10);

    // Step 3: LLM classification with pattern hint
    const result = await deps.triageClassifier.classify(email, patternResult, examples);

    // Step 4: Log the classification
    await deps.triageLog.log({
      emailId,
      accountId: email.accountId,
      patternHint: patternResult.folder,
      llmFolder: result.folder,
      llmConfidence: result.confidence,
      patternAgreed: result.patternAgreed,
      finalFolder: result.folder,
      source: 'llm',
      reasoning: result.reasoning,
    });

    return result;
  };

/**
 * Triage and move email to folder (Issue #53)
 *
 * This use case combines classification and IMAP folder movement.
 * If confidence is above threshold, the email is moved to the classified folder.
 * If below threshold, classification still happens but email stays in place.
 */
export const triageAndMoveEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'folders' | 'patternMatcher' | 'triageClassifier' | 'trainingRepo' | 'triageLog' | 'imapFolderOps'>) =>
  async (emailId: number, options: { confidenceThreshold?: number } = {}): Promise<TriageClassificationResult> => {
    const { confidenceThreshold = 0.7 } = options;

    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    // Step 1: Pattern matching (fast, local)
    const patternResult = deps.patternMatcher.match(email);

    // Step 2: Get relevant training examples
    const examples = await deps.trainingRepo.getRelevantExamples(email.accountId, email, 10);

    // Step 3: LLM classification with pattern hint
    const result = await deps.triageClassifier.classify(email, patternResult, examples);

    // Step 4: Log the classification
    await deps.triageLog.log({
      emailId,
      accountId: email.accountId,
      patternHint: patternResult.folder,
      llmFolder: result.folder,
      llmConfidence: result.confidence,
      patternAgreed: result.patternAgreed,
      finalFolder: result.folder,
      source: 'llm',
      reasoning: result.reasoning,
    });

    // Step 5: Move to folder if confidence is above threshold
    if (result.confidence >= confidenceThreshold) {
      const currentFolder = await deps.folders.findById(email.folderId);
      if (!currentFolder) throw new Error('Folder not found');

      // Skip if already in the target folder
      if (currentFolder.path !== result.folder) {
        const account = await deps.accounts.findById(email.accountId);
        if (!account) throw new Error('Account not found');

        // Move via IMAP
        await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, result.folder);

        // Update local DB to reflect the new folder (Issue #53)
        const newFolder = await deps.folders.getOrCreate(email.accountId, result.folder, result.folder);
        await deps.emails.setFolderId(emailId, newFolder.id);
      }
    }

    return result;
  };

export const moveEmailToTriageFolder = (deps: Pick<Deps, 'emails' | 'accounts' | 'folders' | 'imapFolderOps' | 'triageLog'>) =>
  async (emailId: number, folder: TriageFolder): Promise<void> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const currentFolder = await deps.folders.findById(email.folderId);
    if (!currentFolder) throw new Error('Folder not found');

    // Skip IMAP move if already in the target folder
    if (currentFolder.path !== folder) {
      const account = await deps.accounts.findById(email.accountId);
      if (!account) throw new Error('Account not found');

      // Move via IMAP
      await deps.imapFolderOps.moveMessage(account, email.uid, currentFolder.path, folder);

      // Update local DB to reflect the new folder (Issue #53)
      const newFolder = await deps.folders.getOrCreate(email.accountId, folder, folder);
      await deps.emails.setFolderId(emailId, newFolder.id);
    }

    // Log the move (even if no actual move happened, for audit trail)
    await deps.triageLog.log({
      emailId,
      accountId: email.accountId,
      patternHint: null,
      llmFolder: null,
      llmConfidence: null,
      patternAgreed: null,
      finalFolder: folder,
      source: 'user-override',
      reasoning: 'Manual move by user',
    });
  };

export const learnFromTriageCorrection = (deps: Pick<Deps, 'emails' | 'trainingRepo' | 'senderRules'>) =>
  async (emailId: number, aiSuggestion: string, userChoice: TriageFolder): Promise<void> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const domain = extractDomain(email.from.address);
    const wasCorrection = aiSuggestion !== userChoice;

    // Save training example
    await deps.trainingRepo.save({
      accountId: email.accountId,
      emailId: email.id,
      fromAddress: email.from.address,
      fromDomain: domain,
      subject: email.subject,
      aiSuggestion,
      userChoice,
      wasCorrection,
      source: 'review_folder',
    });

    // Update or create sender rule
    if (wasCorrection) {
      const existingRule = await deps.senderRules.findByPattern(email.accountId, domain, 'domain');

      if (existingRule) {
        // Same correction? Increment count, might enable auto-apply
        if (existingRule.targetFolder === userChoice) {
          await deps.senderRules.incrementCount(existingRule.id);

          // Auto-enable if 3+ corrections
          if (existingRule.correctionCount >= 2) {
            await deps.senderRules.upsert({
              ...existingRule,
              autoApply: true,
              confidence: Math.min(0.95, existingRule.confidence + 0.05),
              correctionCount: existingRule.correctionCount + 1,
            });
          }
        } else {
          // Different correction - update the rule
          await deps.senderRules.upsert({
            accountId: email.accountId,
            pattern: domain,
            patternType: 'domain',
            targetFolder: userChoice,
            confidence: 0.8,
            correctionCount: 1,
            autoApply: false,
          });
        }
      } else {
        // Create new rule
        await deps.senderRules.upsert({
          accountId: email.accountId,
          pattern: domain,
          patternType: 'domain',
          targetFolder: userChoice,
          confidence: 0.8,
          correctionCount: 1,
          autoApply: false,
        });
      }
    }
  };

export const snoozeEmail = (deps: Pick<Deps, 'emails' | 'folders' | 'snoozes'>) =>
  async (emailId: number, until: Date, reason: 'shipping' | 'waiting_reply' | 'manual'): Promise<void> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');

    const folder = await deps.folders.findById(email.folderId);

    await deps.snoozes.create({
      emailId,
      snoozeUntil: until,
      originalFolder: folder?.path || 'INBOX',
      reason,
    });
  };

export const unsnoozeEmail = (deps: Pick<Deps, 'snoozes'>) =>
  async (emailId: number): Promise<void> => {
    await deps.snoozes.delete(emailId);
  };

export const processSnoozedEmails = (deps: Pick<Deps, 'snoozes' | 'emails' | 'accounts' | 'folders' | 'imapFolderOps'>) =>
  async (): Promise<number> => {
    const dueSnoozes = await deps.snoozes.findDue();
    let processed = 0;

    for (const snooze of dueSnoozes) {
      try {
        const email = await deps.emails.findById(snooze.emailId);
        if (!email) {
          await deps.snoozes.delete(snooze.emailId);
          continue;
        }

        const account = await deps.accounts.findById(email.accountId);
        if (!account) continue;

        const currentFolder = await deps.folders.findById(email.folderId);
        if (!currentFolder) continue;

        // Move back to original folder
        await deps.imapFolderOps.moveMessage(
          account,
          email.uid,
          currentFolder.path,
          snooze.originalFolder
        );

        // Update local DB to reflect the new folder (Issue #53)
        const newFolder = await deps.folders.getOrCreate(email.accountId, snooze.originalFolder, snooze.originalFolder);
        await deps.emails.setFolderId(snooze.emailId, newFolder.id);

        await deps.snoozes.delete(snooze.emailId);
        processed++;
      } catch (e) {
        console.error(`Failed to unsnooze email ${snooze.emailId}:`, e);
      }
    }

    return processed;
  };

export const saveTrainingExample = (deps: Pick<Deps, 'trainingRepo'>) =>
  async (example: Omit<TrainingExample, 'id' | 'createdAt'>): Promise<TrainingExample> => {
    return deps.trainingRepo.save(example);
  };

export const getTrainingExamples = (deps: Pick<Deps, 'trainingRepo'>) =>
  async (accountId: number, limit?: number): Promise<TrainingExample[]> => {
    return deps.trainingRepo.findByAccount(accountId, limit);
  };

export const ensureTriageFolders = (deps: Pick<Deps, 'accounts' | 'imapFolderOps'>) =>
  async (accountId: number): Promise<string[]> => {
    const account = await deps.accounts.findById(accountId);
    if (!account) throw new Error('Account not found');

    return deps.imapFolderOps.ensureTriageFolders(account);
  };

export const getSenderRules = (deps: Pick<Deps, 'senderRules'>) =>
  async (accountId: number) => {
    return deps.senderRules.findByAccount(accountId);
  };

export const getTriageLog = (deps: Pick<Deps, 'triageLog'>) =>
  async (limit?: number, accountId?: number) => {
    return deps.triageLog.findRecent(limit, accountId);
  };

/**
 * Select diverse training emails for onboarding (Issue #55)
 *
 * Fetches a pool of candidate emails, runs silent AI classification,
 * then selects up to `maxEmails` diverse samples by:
 * - Limiting to max 2 per sender domain
 * - Ensuring variety across predicted categories
 * - Prioritizing emails with clear classification signals
 *
 * The AI predictions are NOT shown to the user - they classify from scratch.
 * This just ensures we present a diverse set for training.
 */
export const selectDiverseTrainingEmails = (deps: Pick<Deps, 'emails' | 'patternMatcher'>) =>
  async (accountId: number, options: { maxEmails?: number; poolSize?: number } = {}): Promise<Email[]> => {
    const { maxEmails = 12, poolSize = 50 } = options;

    // Step 1: Fetch candidate pool
    const candidates = await deps.emails.list({
      accountId,
      limit: poolSize,
    });

    if (candidates.length === 0) {
      return [];
    }

    // Step 2: Run silent pattern matching (fast, no LLM cost)
    // We use pattern matching instead of full LLM to keep onboarding fast
    const classified = candidates.map(email => ({
      email,
      prediction: deps.patternMatcher.match(email),
      domain: extractDomain(email.from.address),
    }));

    // Step 3: Group by predicted folder
    const byFolder = new Map<string, typeof classified>();
    for (const item of classified) {
      const folder = item.prediction.folder;
      if (!byFolder.has(folder)) {
        byFolder.set(folder, []);
      }
      byFolder.get(folder)!.push(item);
    }

    // Step 4: Select diverse emails
    const selected: Email[] = [];
    const domainCount = new Map<string, number>();

    // Helper to check domain limit
    const canSelectDomain = (domain: string) => (domainCount.get(domain) || 0) < 2;
    const recordDomain = (domain: string) => domainCount.set(domain, (domainCount.get(domain) || 0) + 1);

    // Priority 1: One from each detected category (ensure variety)
    const folders = Array.from(byFolder.keys());
    for (const folder of folders) {
      if (selected.length >= maxEmails) break;

      const items = byFolder.get(folder)!;
      // Find item with unique domain if possible
      for (const item of items) {
        if (canSelectDomain(item.domain)) {
          selected.push(item.email);
          recordDomain(item.domain);
          // Remove from pool (check idx to avoid splice(-1) removing last element)
          const idx = items.indexOf(item);
          if (idx !== -1) {
            items.splice(idx, 1);
          }
          break;
        }
      }
    }

    // Priority 2: Fill remaining slots with high-confidence predictions
    // Sort remaining by confidence descending
    const remaining = classified
      .filter(item => !selected.includes(item.email))
      .sort((a, b) => b.prediction.confidence - a.prediction.confidence);

    for (const item of remaining) {
      if (selected.length >= maxEmails) break;
      if (!canSelectDomain(item.domain)) continue;

      selected.push(item.email);
      recordDomain(item.domain);
    }

    // Priority 3: If still not enough, relax domain constraint
    if (selected.length < maxEmails) {
      for (const item of remaining) {
        if (selected.length >= maxEmails) break;
        if (selected.includes(item.email)) continue;

        selected.push(item.email);
      }
    }

    return selected;
  };

// ============================================
// Factory: Create all use cases with deps
// ============================================

export function createUseCases(deps: Deps) {
  return {
    // Emails
    listEmails: listEmails(deps),
    getEmail: getEmail(deps),
    getEmailBody: getEmailBody(deps),
    searchEmails: searchEmails(deps),
    markRead: markRead(deps),
    starEmail: starEmail(deps),
    archiveEmail: archiveEmail(deps),
    unarchiveEmail: unarchiveEmail(deps),
    deleteEmail: deleteEmail(deps),
    trashEmail: trashEmail(deps),

    // Tags removed - using folders for organization (Issue #54)

    // Sync
    syncMailbox: syncMailbox(deps),
    syncAllMailboxes: syncAllMailboxes(deps),
    syncWithAutoClassify: syncWithAutoClassify(deps),
    syncAllWithAutoClassify: syncAllWithAutoClassify(deps),
    cancelSync: cancelSync(deps),

    // Classification
    classifyEmail: classifyEmail(deps),
    classifyAndApply: classifyAndApply(deps),
    classifyAndTriage: classifyAndTriage(deps),
    classifyNewEmails: classifyNewEmails(deps),

    // LLM Provider
    validateLLMProvider: validateLLMProvider(deps),
    listLLMModels: listLLMModels(deps),
    testLLMConnection: testLLMConnection(deps),
    isLLMConfigured: isLLMConfigured(deps),

    // Background Tasks
    startBackgroundClassification: startBackgroundClassification(deps),
    getBackgroundTaskStatus: getBackgroundTaskStatus(deps),
    clearBackgroundTask: clearBackgroundTask(deps),

    // AI Sort
    getPendingReviewQueue: getPendingReviewQueue(deps),
    getEmailsByPriority: getEmailsByPriority(deps),
    getFailedClassifications: getFailedClassifications(deps),
    getClassificationStats: getClassificationStats(deps),
    acceptClassification: acceptClassification(deps),
    dismissClassification: dismissClassification(deps),
    retryClassification: retryClassification(deps),
    reclassifyEmail: reclassifyEmail(deps),
    getClassificationState: getClassificationState(deps),
    getConfusedPatterns: getConfusedPatterns(deps),
    clearConfusedPatterns: clearConfusedPatterns(deps),
    getRecentActivity: getRecentActivity(deps),
    bulkAcceptClassifications: bulkAcceptClassifications(deps),
    bulkDismissClassifications: bulkDismissClassifications(deps),
    bulkMoveToFolder: bulkMoveToFolder(deps),
    getPendingReviewCount: getPendingReviewCount(deps),
    classifyUnprocessed: classifyUnprocessed(deps),

    // Accounts
    listAccounts: listAccounts(deps),
    getAccount: getAccount(deps),
    createAccount: createAccount(deps),
    updateAccount: updateAccount(deps),
    deleteAccount: deleteAccount(deps),
    addAccount: addAccount(deps),
    testImapConnection: testImapConnection(deps),
    testSmtpConnection: testSmtpConnection(deps),
    
    // Send
    sendEmail: sendEmail(deps),
    replyToEmail: replyToEmail(deps),
    forwardEmail: forwardEmail(deps),

    // Remote Images
    loadRemoteImages: loadRemoteImages(deps),
    hasLoadedRemoteImages: hasLoadedRemoteImages(deps),
    getRemoteImagesSetting: getRemoteImagesSetting(deps),
    setRemoteImagesSetting: setRemoteImagesSetting(deps),
    clearImageCache: clearImageCache(deps),
    clearAllImageCache: clearAllImageCache(deps),
    autoLoadImagesForEmail: autoLoadImagesForEmail(deps),

    // Drafts
    saveDraft: saveDraft(deps),
    getDraft: getDraft(deps),
    listDrafts: listDrafts(deps),
    deleteDraft: deleteDraft(deps),

    // Contacts
    getRecentContacts: getRecentContacts(deps),
    searchContacts: searchContacts(deps),
    recordContactUsage: recordContactUsage(deps),

    // Database Health
    checkDatabaseIntegrity: checkDatabaseIntegrity(deps),
    createDatabaseBackup: createDatabaseBackup(deps),

    // Email Triage
    triageEmail: triageEmail(deps),
    triageAndMoveEmail: triageAndMoveEmail(deps),
    moveEmailToTriageFolder: moveEmailToTriageFolder(deps),
    learnFromTriageCorrection: learnFromTriageCorrection(deps),
    snoozeEmail: snoozeEmail(deps),
    unsnoozeEmail: unsnoozeEmail(deps),
    processSnoozedEmails: processSnoozedEmails(deps),
    saveTrainingExample: saveTrainingExample(deps),
    getTrainingExamples: getTrainingExamples(deps),
    ensureTriageFolders: ensureTriageFolders(deps),
    getSenderRules: getSenderRules(deps),
    getTriageLog: getTriageLog(deps),
    selectDiverseTrainingEmails: selectDiverseTrainingEmails(deps),
  };
}

export type UseCases = ReturnType<typeof createUseCases>;
