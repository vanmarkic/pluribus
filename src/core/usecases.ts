/**
 * Use Cases
 * 
 * Application logic as simple functions.
 * Each function takes deps and returns a function that does the work.
 * This is partial application / currying for DI.
 */

import type { Deps, AccountInput, SmtpConfig, EmailDraft, SendResult, SyncResult, CachedImage, RemoteImagesSetting, DraftRepo } from './ports';
import type { Email, EmailBody, Tag, AppliedTag, Account, ListEmailsOptions, SyncOptions, Classification, ClassificationState, ClassificationStats, ClassificationFeedback, ConfusedPattern, Draft, DraftInput, ListDraftsOptions } from './domain';
import { extractDomain, extractSubjectPattern } from './domain';

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

export const archiveEmail = (deps: Pick<Deps, 'tags'>) =>
  async (emailId: number): Promise<void> => {
    const archiveTag = await deps.tags.findBySlug('archive');
    const inboxTag = await deps.tags.findBySlug('inbox');

    if (archiveTag) await deps.tags.apply(emailId, archiveTag.id, 'manual');
    if (inboxTag) await deps.tags.remove(emailId, inboxTag.id);
  };

export const deleteEmail = (deps: Pick<Deps, 'emails' | 'imageCache'>) =>
  async (id: number): Promise<void> => {
    // Clear cached images before deleting email
    await deps.imageCache.clearCache(id);
    await deps.emails.delete(id);
  };

// ============================================
// Tag Use Cases
// ============================================

export const listTags = (deps: Pick<Deps, 'tags'>) =>
  (): Promise<Tag[]> =>
    deps.tags.findAll();

export const getEmailTags = (deps: Pick<Deps, 'tags'>) =>
  (emailId: number): Promise<AppliedTag[]> =>
    deps.tags.findByEmailId(emailId);

export const applyTag = (deps: Pick<Deps, 'tags'>) =>
  (emailId: number, tagId: number, source = 'manual', confidence?: number): Promise<void> =>
    deps.tags.apply(emailId, tagId, source, confidence);

export const removeTag = (deps: Pick<Deps, 'tags'>) =>
  (emailId: number, tagId: number): Promise<void> =>
    deps.tags.remove(emailId, tagId);

export const createTag = (deps: Pick<Deps, 'tags'>) =>
  (tag: Omit<Tag, 'id'>): Promise<Tag> =>
    deps.tags.create(tag);

// ============================================
// Sync Use Cases
// ============================================

export const syncMailbox = (deps: Pick<Deps, 'accounts' | 'sync'>) =>
  async (accountId: number, options: SyncOptions = {}): Promise<SyncResult> => {
    const account = await deps.accounts.findById(accountId);
    if (!account) throw new Error('Account not found');

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

export const syncWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'tags' | 'classifier' | 'classificationState' | 'config'>) =>
  async (accountId: number, options: SyncOptions = {}): Promise<SyncResult & { classified?: number; skipped?: number }> => {
    // First, sync the mailbox
    const syncResult = await syncMailbox(deps)(accountId, options);

    // Check if auto-classify is enabled
    const llmConfig = deps.config.getLLMConfig();
    if (!llmConfig.autoClassify || syncResult.newEmailIds.length === 0) {
      return syncResult;
    }

    // Classify new emails
    try {
      const classifyResult = await classifyNewEmails(deps)(
        syncResult.newEmailIds,
        llmConfig.confidenceThreshold
      );
      console.log(`Auto-classified ${classifyResult.classified} new emails, skipped ${classifyResult.skipped}`);
      return { ...syncResult, ...classifyResult };
    } catch (err) {
      console.error('Auto-classification failed:', err);
      return syncResult;
    }
  };

export const syncAllWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'tags' | 'classifier' | 'classificationState' | 'config'>) =>
  async (options: SyncOptions = {}): Promise<SyncResult & { classified?: number; skipped?: number }> => {
    // First, sync all mailboxes
    const syncResult = await syncAllMailboxes(deps)(options);

    // Check if auto-classify is enabled
    const llmConfig = deps.config.getLLMConfig();
    if (!llmConfig.autoClassify || syncResult.newEmailIds.length === 0) {
      return syncResult;
    }

    // Classify new emails (runs in background conceptually, but we await for result tracking)
    try {
      const classifyResult = await classifyNewEmails(deps)(
        syncResult.newEmailIds,
        llmConfig.confidenceThreshold
      );
      console.log(`Auto-classified ${classifyResult.classified} new emails, skipped ${classifyResult.skipped}`);
      return { ...syncResult, ...classifyResult };
    } catch (err) {
      console.error('Auto-classification failed:', err);
      return syncResult;
    }
  };

// ============================================
// Classification Use Cases
// ============================================

export const classifyEmail = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier'>) =>
  async (emailId: number): Promise<Classification> => {
    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');
    
    const body = await deps.emails.getBody(emailId);
    const existingTags = await deps.tags.findByEmailId(emailId);
    
    return deps.classifier.classify(
      email,
      body || undefined,
      existingTags.map(t => t.slug)
    );
  };

export const classifyAndApply = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier' | 'classificationState'>) =>
  async (emailId: number, confidenceThreshold = 0.85): Promise<Classification> => {
    const result = await classifyEmail(deps)(emailId);

    // If classifier suggested a new tag, create it and add to suggestedTags
    let suggestedTags = [...result.suggestedTags];
    if (result.newTag) {
      // Check if tag doesn't already exist (in case LLM suggested duplicate)
      const existingTags = await deps.tags.findAll();
      const exists = existingTags.some(t => t.slug === result.newTag!.slug);

      if (!exists) {
        await deps.tags.create({
          name: result.newTag.name,
          slug: result.newTag.slug,
          color: '#6b7280', // Default gray
          isSystem: false,
          sortOrder: 0,
        });
      }

      // Add to suggested tags if not already there
      if (!suggestedTags.includes(result.newTag.slug)) {
        suggestedTags.push(result.newTag.slug);
      }
    }

    // Determine status based on confidence threshold
    const status = result.confidence >= confidenceThreshold ? 'classified' : 'pending_review';

    // Save classification state (clear dismissed_at if re-classifying)
    await deps.classificationState.setState({
      emailId,
      status,
      confidence: result.confidence,
      priority: result.priority,
      suggestedTags: suggestedTags,
      reasoning: result.reasoning,
      classifiedAt: new Date(),
      dismissedAt: null,  // Clear dismissed timestamp on re-classification
      errorMessage: null, // Clear any previous error
    });

    // Only auto-apply tags if above threshold
    if (result.confidence >= confidenceThreshold) {
      const allTags = await deps.tags.findAll();

      for (const tagSlug of suggestedTags) {
        const tag = allTags.find(t => t.slug === tagSlug);
        if (tag) {
          await deps.tags.apply(emailId, tag.id, 'llm', result.confidence);
        }
      }
    }

    return { ...result, suggestedTags };
  };

export const classifyNewEmails = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier' | 'classificationState'>) =>
  async (emailIds: number[], confidenceThreshold = 0.85): Promise<{ classified: number; skipped: number }> => {
    const budget = deps.classifier.getEmailBudget();
    const remainingBudget = budget.limit - budget.used;

    if (remainingBudget <= 0) {
      console.log('Daily email classification budget exhausted');
      return { classified: 0, skipped: emailIds.length };
    }

    // Fetch emails to sort by date (most recent first)
    const emails = await Promise.all(
      emailIds.map(id => deps.emails.findById(id))
    );

    // Sort by date descending (most recent first), filter out nulls
    const sortedEmails = emails
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Limit to remaining budget (prioritizing most recent)
    const emailsToClassify = sortedEmails.slice(0, remainingBudget);
    const skipped = emailIds.length - emailsToClassify.length;

    let classified = 0;
    for (const email of emailsToClassify) {
      try {
        await classifyAndApply(deps)(email.id, confidenceThreshold);
        classified++;
      } catch (error) {
        console.error(`Failed to classify email ${email.id}:`, error);
        // Record error state so user can retry
        await deps.classificationState.setState({
          emailId: email.id,
          status: 'error',
          confidence: null,
          priority: null,
          suggestedTags: [],
          reasoning: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          classifiedAt: new Date(),
        });
      }
    }

    return { classified, skipped };
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

export const startBackgroundClassification = (deps: Pick<Deps, 'backgroundTasks' | 'emails' | 'tags' | 'classifier' | 'classificationState' | 'config'>) =>
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
            suggestedTags: [],
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

export const acceptClassification = (deps: Pick<Deps, 'classificationState' | 'tags'>) =>
  async (emailId: number, appliedTags: string[]): Promise<void> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state) throw new Error('Classification state not found');

    // Determine if tags were edited
    const originalSet = new Set(state.suggestedTags);
    const appliedSet = new Set(appliedTags);
    const isExactMatch = originalSet.size === appliedSet.size &&
      [...originalSet].every(tag => appliedSet.has(tag));

    const action = isExactMatch ? 'accept' : 'accept_edit';
    const accuracyScore = isExactMatch ? 1.0 : 0.98;

    // Log feedback
    await deps.classificationState.logFeedback({
      emailId,
      action,
      originalTags: state.suggestedTags,
      finalTags: appliedTags,
      accuracyScore,
    });

    // Update state
    await deps.classificationState.setState({
      ...state,
      status: 'accepted',
      reviewedAt: new Date(),
    });

    // Apply tags to email, creating any missing tags
    let allTags = await deps.tags.findAll();
    for (const tagSlug of appliedTags) {
      let tag = allTags.find(t => t.slug === tagSlug);
      if (!tag) {
        // Create the tag if it doesn't exist (user may have typed a new tag in TagManager)
        const name = tagSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        tag = await deps.tags.create({ name, slug: tagSlug, color: '#6b7280', isSystem: false, sortOrder: 0 });
        allTags = [...allTags, tag];
      }
      await deps.tags.apply(emailId, tag.id, 'llm', state.confidence ?? undefined);
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
      originalTags: state.suggestedTags,
      finalTags: null,
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

export const retryClassification = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier' | 'classificationState' | 'config'>) =>
  async (emailId: number): Promise<Classification> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state || state.status !== 'error') {
      throw new Error('Email is not in error state');
    }

    const llmConfig = deps.config.getLLMConfig();
    return classifyAndApply(deps)(emailId, llmConfig.confidenceThreshold);
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

export const bulkApplyTag = (deps: Pick<Deps, 'classificationState' | 'tags'>) =>
  async (emailIds: number[], tagSlug: string): Promise<{ applied: number; failed: number }> => {
    let applied = 0;
    let failed = 0;

    const allTags = await deps.tags.findAll();
    const tag = allTags.find(t => t.slug === tagSlug);
    if (!tag) {
      return { applied: 0, failed: emailIds.length };
    }

    for (const emailId of emailIds) {
      try {
        const state = await deps.classificationState.getState(emailId);
        if (!state || state.status !== 'pending_review') {
          failed++;
          continue;
        }

        // Log feedback as accept_edit (user chose different tag)
        await deps.classificationState.logFeedback({
          emailId,
          action: 'accept_edit',
          originalTags: state.suggestedTags,
          finalTags: [tagSlug],
          accuracyScore: 0.98,
        });

        // Update state
        await deps.classificationState.setState({
          ...state,
          status: 'accepted',
          reviewedAt: new Date(),
        });

        // Apply the chosen tag
        await deps.tags.apply(emailId, tag.id, 'llm', state.confidence ?? undefined);

        applied++;
      } catch {
        failed++;
      }
    }

    return { applied, failed };
  };

export const bulkAcceptClassifications = (deps: Pick<Deps, 'classificationState' | 'tags'>) =>
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
          originalTags: state.suggestedTags,
          finalTags: state.suggestedTags,
          accuracyScore: 1.0,
        });

        // Update state
        await deps.classificationState.setState({
          ...state,
          status: 'accepted',
          reviewedAt: new Date(),
        });

        // Apply tags
        const allTags = await deps.tags.findAll();
        for (const tagSlug of state.suggestedTags) {
          const tag = allTags.find(t => t.slug === tagSlug);
          if (tag) {
            await deps.tags.apply(emailId, tag.id, 'llm', state.confidence ?? undefined);
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

        // Log feedback
        await deps.classificationState.logFeedback({
          emailId,
          action: 'dismiss',
          originalTags: state.suggestedTags,
          finalTags: null,
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

export const classifyUnprocessed = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier' | 'classificationState' | 'config'>) =>
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
  /** Max messages downloaded per folder - UI can display "Only 1000 most recent emails downloaded" */
  maxMessagesPerFolder: number;
};

const INITIAL_SYNC_MAX_MESSAGES = 1000;

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
        maxMessagesPerFolder: INITIAL_SYNC_MAX_MESSAGES,
      };
    }

    // Perform initial sync for provider-specific folders with max 1000 messages
    const foldersToSync = deps.sync.getDefaultFolders(account.imapHost);
    let totalNewCount = 0;
    const allNewEmailIds: number[] = [];

    for (const folder of foldersToSync) {
      try {
        const result = await deps.sync.sync(createdAccount, { folder, maxMessages: INITIAL_SYNC_MAX_MESSAGES });
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
      maxMessagesPerFolder: INITIAL_SYNC_MAX_MESSAGES,
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

export const sendEmail = (deps: Pick<Deps, 'accounts' | 'sender' | 'secrets'>) =>
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
    
    return deps.sender.send(account.email, smtpConfig, draft);
  };

export const replyToEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'sender' | 'secrets'>) =>
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

export const forwardEmail = (deps: Pick<Deps, 'emails' | 'accounts' | 'sender' | 'secrets'>) =>
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
    deleteEmail: deleteEmail(deps),

    // Tags
    listTags: listTags(deps),
    getEmailTags: getEmailTags(deps),
    applyTag: applyTag(deps),
    removeTag: removeTag(deps),
    createTag: createTag(deps),
    
    // Sync
    syncMailbox: syncMailbox(deps),
    syncAllMailboxes: syncAllMailboxes(deps),
    syncWithAutoClassify: syncWithAutoClassify(deps),
    syncAllWithAutoClassify: syncAllWithAutoClassify(deps),

    // Classification
    classifyEmail: classifyEmail(deps),
    classifyAndApply: classifyAndApply(deps),
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
    getConfusedPatterns: getConfusedPatterns(deps),
    clearConfusedPatterns: clearConfusedPatterns(deps),
    getRecentActivity: getRecentActivity(deps),
    bulkAcceptClassifications: bulkAcceptClassifications(deps),
    bulkDismissClassifications: bulkDismissClassifications(deps),
    bulkApplyTag: bulkApplyTag(deps),
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

    // Drafts
    saveDraft: saveDraft(deps),
    getDraft: getDraft(deps),
    listDrafts: listDrafts(deps),
    deleteDraft: deleteDraft(deps),
  };
}

export type UseCases = ReturnType<typeof createUseCases>;
