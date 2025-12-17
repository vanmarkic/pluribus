/**
 * Email Use Cases
 *
 * All use cases related to email operations:
 * - Listing, reading, searching emails
 * - Marking read/starred
 * - Archiving, trashing, deleting
 * - Remote images
 */

import type { Deps } from '../ports';
import type { Email, EmailBody, ListEmailsOptions } from '../domain';
import type { CachedImage, RemoteImagesSetting } from '../ports';

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
