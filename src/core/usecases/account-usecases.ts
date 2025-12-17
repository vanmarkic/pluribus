/**
 * Account Use Cases
 *
 * All use cases related to email accounts:
 * - Listing, creating, updating, deleting accounts
 * - Testing connections
 * - Adding accounts with initial sync
 * - Sending emails
 */

import type { Deps, AccountInput, SmtpConfig, EmailDraft, SendResult } from '../ports';
import type { Account, DEFAULT_SYNC_DAYS } from '../domain';
import { DEFAULT_SYNC_DAYS as SYNC_DAYS } from '../domain';

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
  syncResult: { newCount: number; newEmailIds: number[] };
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
        syncDays: SYNC_DAYS,
      };
    }

    // Perform initial sync for provider-specific folders with date-based filter
    const foldersToSync = deps.sync.getDefaultFolders(account.imapHost);
    const since = new Date(Date.now() - SYNC_DAYS * 24 * 60 * 60 * 1000);
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
      syncDays: SYNC_DAYS,
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
