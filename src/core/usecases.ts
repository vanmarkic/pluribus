/**
 * Use Cases
 * 
 * Application logic as simple functions.
 * Each function takes deps and returns a function that does the work.
 * This is partial application / currying for DI.
 */

import type { Deps, AccountInput, SmtpConfig, EmailDraft, SendResult, SyncResult } from './ports';
import type { Email, EmailBody, Tag, AppliedTag, Account, ListEmailsOptions, SyncOptions, Classification } from './domain';

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
  (query: string, limit = 100): Promise<Email[]> =>
    deps.emails.search(query, limit);

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

export const deleteEmail = (deps: Pick<Deps, 'emails'>) =>
  (id: number): Promise<void> =>
    deps.emails.delete(id);

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

    // Get default folders from the sync adapter (adapter knows provider-specific names)
    const foldersToSync = options.folders || deps.sync.getDefaultFolders();

    for (const account of accounts) {
      for (const folder of foldersToSync) {
        try {
          const result = await deps.sync.sync(account, { ...options, folder });
          total += result.newCount;
          allNewEmailIds.push(...result.newEmailIds);
        } catch (e) {
          // Folder might not exist on this provider, continue to next
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (!errorMsg.includes('NONEXISTENT') && !errorMsg.includes('does not exist')) {
            console.error(`Failed to sync ${account.email}/${folder}:`, e);
          }
        }
      }
      await deps.accounts.updateLastSync(account.id);
    }

    return { newCount: total, newEmailIds: allNewEmailIds };
  };

export const syncWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'tags' | 'classifier' | 'config'>) =>
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

export const syncAllWithAutoClassify = (deps: Pick<Deps, 'accounts' | 'sync' | 'emails' | 'tags' | 'classifier' | 'config'>) =>
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

export const classifyAndApply = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier'>) =>
  async (emailId: number, confidenceThreshold = 0.85): Promise<Classification> => {
    const result = await classifyEmail(deps)(emailId);

    if (result.confidence >= confidenceThreshold) {
      const allTags = await deps.tags.findAll();

      for (const tagSlug of result.suggestedTags) {
        const tag = allTags.find(t => t.slug === tagSlug);
        if (tag) {
          await deps.tags.apply(emailId, tag.id, 'llm', result.confidence);
        }
      }
    }

    return result;
  };

export const classifyNewEmails = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier'>) =>
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
        // Continue with next email even if one fails
      }
    }

    return { classified, skipped };
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
    
    // Accounts
    listAccounts: listAccounts(deps),
    getAccount: getAccount(deps),
    createAccount: createAccount(deps),
    updateAccount: updateAccount(deps),
    deleteAccount: deleteAccount(deps),
    testImapConnection: testImapConnection(deps),
    testSmtpConnection: testSmtpConnection(deps),
    
    // Send
    sendEmail: sendEmail(deps),
    replyToEmail: replyToEmail(deps),
    forwardEmail: forwardEmail(deps),
  };
}

export type UseCases = ReturnType<typeof createUseCases>;
