/**
 * Classification Use Cases
 *
 * All use cases related to email classification and AI sort:
 * - Email classification (LLM)
 * - Classification state management
 * - Pending review queue
 * - Accept/dismiss/retry/reclassify
 * - Bulk operations
 * - Confused patterns tracking
 * - LLM provider management
 * - Background classification tasks
 */

import type { Deps } from '../ports';
import type { Classification, ClassificationState, ClassificationStats, ClassificationFeedback, ConfusedPattern, Email, TriageFolder, TriageClassificationResult } from '../domain';
import { extractDomain, extractSubjectPattern } from '../domain';

// Import triage function (will be resolved after barrel export)
import { triageAndMoveEmail } from './triage-usecases';

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
  (): Promise<import('../ports').LLMModel[]> =>
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
  (taskId: string): import('../ports').TaskState | null => {
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
