/**
 * Triage Use Cases
 *
 * All use cases related to email triage:
 * - Email triage classification
 * - Moving emails to triage folders
 * - Snoozing emails
 * - Learning from corrections
 * - Training examples
 * - Sender rules
 * - Diverse email selection for onboarding
 */

import type { Deps } from '../ports';
import type { Email, TriageClassificationResult, TriageFolder, TrainingExample } from '../domain';
import { extractDomain } from '../domain';

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
