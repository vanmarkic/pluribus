/**
 * IMAP Sync Adapter
 * 
 * Implements mail sync using ImapFlow.
 * Optimized for large mailboxes with lazy body loading.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import type { MailSync, EmailRepo, AttachmentRepo, FolderRepo, SecureStorage, SentMessage, ImapFolderOps } from '../../core/ports';
import type { Account, Email, EmailBody, SyncProgress, SyncOptions } from '../../core/domain';
import { TRIAGE_FOLDERS } from '../../core/domain';
import { DEFAULT_SYNC_DAYS, MAX_SYNC_EMAILS } from '../../core/domain';

type ProgressCallback = (p: SyncProgress) => void;

// Connection TTL: close idle connections after 10 minutes
const CONNECTION_TTL_MS = 10 * 60 * 1000;

// ============================================
// Row Mapper (IMAP message -> Domain Email)
// ============================================

type ImapMessage = {
  uid: number;
  envelope: {
    messageId?: string;
    subject?: string;
    from?: Array<{ address?: string; name?: string }>;
    to?: Array<{ address?: string }>;
    date?: Date;
    inReplyTo?: string;
  };
  flags?: Set<string>;
  size?: number;
  bodyStructure?: unknown;
  headers?: Buffer;
};

/**
 * Parse raw headers buffer into a Map.
 * Headers format: "Header-Name: value\r\n"
 */
function parseHeaders(buffer: Buffer | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!buffer) return result;

  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/);
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuation of previous header (folded)
      currentValue += ' ' + line.trim();
    } else if (line.includes(':')) {
      // Save previous header if exists
      if (currentKey) {
        result.set(currentKey.toLowerCase(), currentValue);
      }
      // Parse new header
      const colonIndex = line.indexOf(':');
      currentKey = line.substring(0, colonIndex).trim();
      currentValue = line.substring(colonIndex + 1).trim();
    }
  }
  // Save last header
  if (currentKey) {
    result.set(currentKey.toLowerCase(), currentValue);
  }

  return result;
}

function mapImapToEmail(
  msg: ImapMessage,
  accountId: number,
  folderId: number,
  hasAttachments: boolean
): Omit<Email, 'id'> {
  const env = msg.envelope;
  const headers = parseHeaders(msg.headers);
  const messageId = env.messageId || `local-${Date.now()}-${msg.uid}`;

  // Extract thread-related headers
  // inReplyTo from envelope, references from headers
  const inReplyTo = env.inReplyTo || null;
  const references = headers.get('references') || null;

  // Compute thread_id: first message-id in references chain (thread root),
  // or own message-id if standalone email
  let threadId: string | null = null;
  if (references) {
    // References is space-separated list of message-ids
    const firstRef = references.trim().split(/\s+/)[0];
    if (firstRef) {
      threadId = firstRef;
    }
  }
  if (!threadId) {
    threadId = messageId;
  }

  // Extract unsubscribe headers
  const listUnsubscribe = headers.get('list-unsubscribe') || null;
  const listUnsubscribePost = headers.get('list-unsubscribe-post') || null;

  return {
    messageId,
    accountId,
    folderId,
    uid: msg.uid,
    subject: env.subject || '(no subject)',
    from: {
      address: env.from?.[0]?.address || 'unknown',
      name: env.from?.[0]?.name || null,
    },
    to: (env.to || []).map((a) => a.address || ''),
    date: env.date || new Date(),
    snippet: '',
    sizeBytes: msg.size || 0,
    isRead: msg.flags?.has('\\Seen') || false,
    isStarred: msg.flags?.has('\\Flagged') || false,
    hasAttachments,
    bodyFetched: false,
    // Threading
    inReplyTo,
    references,
    threadId,
    // Awaiting reply (default values, will be updated later if needed)
    awaitingReply: false,
    awaitingReplySince: null,
    // Unsubscribe
    listUnsubscribe,
    listUnsubscribePost,
  };
}

// ============================================
// Provider-specific folder configurations
// ============================================

type ProviderFolders = {
  inbox: string;
  sent: string;
  drafts: string;
  trash: string;
  archive?: string;
};

// Provider folder mappings - exact paths per provider
// Sources:
// - Gmail: https://imapsync.lamiral.info/FAQ.d/FAQ.Gmail.txt
// - Outlook: https://support.microsoft.com/en-us/office/change-where-sent-email-messages-are-saved
// - Infomaniak: https://www.infomaniak.com/en/support/faq/2107/modify-the-imap-special-folders-of-an-email-address
const PROVIDER_FOLDERS: Record<string, ProviderFolders> = {
  gmail: {
    inbox: 'INBOX',
    sent: '[Gmail]/Sent Mail',
    drafts: '[Gmail]/Drafts',
    trash: '[Gmail]/Trash',
    archive: '[Gmail]/All Mail',
  },
  outlook: {
    inbox: 'INBOX',
    sent: 'Sent',
    drafts: 'Drafts',
    trash: 'Deleted',
  },
  infomaniak: {
    inbox: 'INBOX',
    sent: 'Sent',
    drafts: 'Drafts',
    trash: 'Trash',
    archive: 'Archives',
  },
  // Default for unknown providers
  default: {
    inbox: 'INBOX',
    sent: 'Sent',
    drafts: 'Drafts',
    trash: 'Trash',
  },
};

// Providers that automatically save sent mail to the Sent folder
// For these, we skip IMAP APPEND to avoid duplicates
const PROVIDERS_WITH_AUTO_SENT = new Set(['gmail', 'outlook']);

// Map IMAP host to provider key
function getProviderFromHost(imapHost: string): string {
  const host = imapHost.toLowerCase();
  if (host.includes('gmail') || host.includes('googlemail')) return 'gmail';
  if (host.includes('outlook') || host.includes('office365') || host.includes('hotmail') || host.includes('live.com')) return 'outlook';
  if (host.includes('infomaniak')) return 'infomaniak';
  return 'default';
}

// Get folder config for a provider
export function getProviderFolders(imapHost: string): ProviderFolders {
  const provider = getProviderFromHost(imapHost);
  return PROVIDER_FOLDERS[provider] || PROVIDER_FOLDERS.default;
}

export function createMailSync(
  emailRepo: EmailRepo,
  attachmentRepo: AttachmentRepo,
  folderRepo: FolderRepo,
  secrets: SecureStorage
): MailSync {
  const connections = new Map<number, { client: ImapFlow; lastUsed: number }>();
  const abortControllers = new Map<number, AbortController>();
  const progressCallbacks: ProgressCallback[] = [];

  // Periodic cleanup of stale connections
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [accountId, conn] of connections.entries()) {
      if (now - conn.lastUsed > CONNECTION_TTL_MS) {
        try { conn.client.logout(); } catch {}
        connections.delete(accountId);
      }
    }
  }, 60000); // Check every minute

  // Clear interval on process exit
  if (typeof process !== 'undefined') {
    process.on('beforeExit', () => clearInterval(cleanupInterval));
  }

  function emit(progress: SyncProgress) {
    progressCallbacks.forEach(cb => {
      try { cb(progress); } catch {}
    });
  }

  async function getConnection(account: Account): Promise<ImapFlow> {
    const existing = connections.get(account.id);
    if (existing?.client?.usable) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    const password = await secrets.getPassword(account.email);
    if (!password) throw new Error(`No password for account ${account.email}. Please set it first.`);

    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapPort === 993,
      auth: { user: account.username, pass: password },
      logger: false,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    await client.connect();
    connections.set(account.id, { client, lastUsed: Date.now() });
    return client;
  }

  function checkAttachments(structure: any): boolean {
    if (!structure) return false;
    const check = (part: any): boolean => {
      if (part.disposition === 'attachment') return true;
      if (part.childNodes) return part.childNodes.some(check);
      return false;
    };
    return check(structure);
  }

  return {
    async sync(account, options: SyncOptions = {}) {
      // Poka-yoke: Prevent sync with invalid/mock accounts that would cause FK violations
      if (!account.id || account.id <= 0) {
        throw new Error(`Cannot sync with invalid account ID: ${account.id}. Use testConnection() for testing.`);
      }

      const {
        headersOnly = true,
        batchSize = 500,
        maxMessages,
        since,
        folder = 'INBOX',
      } = options;

      let totalNew = 0;
      const newEmailIds: number[] = [];
      let wasTruncated = false;
      let originalUidCount = 0;
      let total = 0;

      // Create abort controller for this sync
      const abortController = new AbortController();
      abortControllers.set(account.id, abortController);

      try {
        emit({ accountId: account.id, folder, phase: 'connecting', current: 0, total: 0, newCount: 0 });

        const client = await getConnection(account);
        const lock = await client.getMailboxLock(folder);

        try {
          const mailbox = client.mailbox;
          if (!mailbox) throw new Error(`Could not open ${folder}`);

          // Get or create folder record
          const uidValidity = mailbox.uidValidity ? Number(mailbox.uidValidity) : undefined;
          const folderRecord = await folderRepo.getOrCreate(
            account.id, folder,
            folder.split('/').pop() || folder,
            uidValidity
          );

          // Check UIDVALIDITY change
          if (folderRecord.uidValidity && uidValidity && folderRecord.uidValidity !== uidValidity) {
            console.warn(`UIDVALIDITY changed for ${folder}, clearing`);
            await folderRepo.clear(folderRecord.id);
          }

          emit({ accountId: account.id, folder, phase: 'counting', current: 0, total: 0, newCount: 0 });

          // Search for new messages
          // Build search criteria: combine UID range with optional SINCE date filter
          const searchCriteria: any = {};
          if (folderRecord.lastUid > 0) {
            searchCriteria.uid = `${folderRecord.lastUid + 1}:*`;
          } else {
            // Poka-yoke: Initial sync ALWAYS uses date filter to prevent downloading years of email
            const defaultSince = new Date(Date.now() - DEFAULT_SYNC_DAYS * 24 * 60 * 60 * 1000);
            searchCriteria.since = since || defaultSince;
          }

          const searchResult = await client.search(searchCriteria, { uid: true });
          let uids = Array.isArray(searchResult) ? searchResult : [];

          // Poka-yoke: Hard limit to prevent runaway syncs
          const effectiveMax = maxMessages ? Math.min(maxMessages, MAX_SYNC_EMAILS) : MAX_SYNC_EMAILS;
          originalUidCount = uids.length;
          wasTruncated = uids.length > effectiveMax;

          if (wasTruncated) {
            console.warn(`Truncating ${folder} sync: ${uids.length} emails found, limiting to ${effectiveMax} most recent`);
            uids = uids.slice(-effectiveMax);
          }

          total = uids.length;
          if (total === 0) {
            emit({ accountId: account.id, folder, phase: 'complete', current: 0, total: 0, newCount: 0 });
            return {
              newCount: 0,
              newEmailIds: [],
              truncated: wasTruncated,
              totalAvailable: originalUidCount,
              synced: 0
            };
          }

          emit({ accountId: account.id, folder, phase: 'fetching', current: 0, total, newCount: 0 });

          let processed = 0;
          let maxUid = folderRecord.lastUid;

          // Process in batches
          for (let i = 0; i < uids.length; i += batchSize) {
            // Check if sync was cancelled
            if (abortController.signal.aborted) {
              emit({ accountId: account.id, folder, phase: 'cancelled', current: processed, total, newCount: totalNew });
              return {
                newCount: totalNew,
                newEmailIds,
                truncated: wasTruncated,
                totalAvailable: originalUidCount,
                synced: total
              };
            }

            const batch = uids.slice(i, i + batchSize);
            const emails: Omit<Email, 'id'>[] = [];

            for await (const msg of client.fetch(batch, {
              envelope: true,
              flags: true,
              bodyStructure: true,
              size: true,
              headers: ['references', 'list-unsubscribe', 'list-unsubscribe-post'],
            }, { uid: true })) {
              if (!msg.envelope) continue;

              const email = mapImapToEmail(
                msg as ImapMessage,
                account.id,
                folderRecord.id,
                checkAttachments(msg.bodyStructure)
              );
              emails.push(email);

              if (msg.uid > maxUid) maxUid = msg.uid;
              processed++;
            }

            // Batch insert
            const result = await emailRepo.insertBatch(emails);
            totalNew += result.count;
            newEmailIds.push(...result.ids);

            emit({
              accountId: account.id, folder,
              phase: 'storing',
              current: processed, total,
              newCount: totalNew,
            });

            // Small delay between batches
            if (i + batchSize < uids.length) {
              await new Promise(r => setTimeout(r, 50));
            }
          }

          // Update sync state
          if (maxUid > folderRecord.lastUid) {
            await folderRepo.updateLastUid(folderRecord.id, maxUid);
          }

          emit({
            accountId: account.id, folder,
            phase: 'complete',
            current: total, total,
            newCount: totalNew,
          });

        } finally {
          lock.release();
        }

      } catch (error) {
        emit({
          accountId: account.id, folder,
          phase: 'error',
          current: 0, total: 0, newCount: 0,
          error: String(error),
        });
        throw error;
      } finally {
        // Clean up abort controller to prevent memory leak
        abortControllers.delete(account.id);
      }

      return {
        newCount: totalNew,
        newEmailIds,
        truncated: wasTruncated,
        totalAvailable: originalUidCount,
        synced: total
      };
    },

    async fetchBody(account, emailId) {
      // Check cache first
      const cached = await emailRepo.getBody(emailId);
      if (cached) return cached;

      const email = await emailRepo.findById(emailId);
      if (!email) throw new Error('Email not found');

      // Poka-yoke: Verify email belongs to this account
      if (email.accountId !== account.id) {
        throw new Error(`Account mismatch: email belongs to account ${email.accountId}, not ${account.id}`);
      }

      // Look up the folder path - UIDs are only unique within a folder
      const folder = await folderRepo.findById(email.folderId);
      if (!folder) throw new Error('Folder not found');

      const client = await getConnection(account);
      const lock = await client.getMailboxLock(folder.path);

      try {
        let text = '';
        let html = '';

        for await (const msg of client.fetch([email.uid], { source: true }, { uid: true })) {
          if (msg.source) {
            const parsed = await simpleParser(msg.source);
            text = parsed.text || '';
            html = (typeof parsed.html === 'string' ? parsed.html : '') || '';

            // Save attachments
            if (parsed.attachments && parsed.attachments.length > 0) {
              for (const att of parsed.attachments) {
                await attachmentRepo.save({
                  emailId,
                  filename: att.filename || 'unnamed',
                  contentType: att.contentType || 'application/octet-stream',
                  size: att.size || 0,
                  cid: att.cid || undefined,
                  content: att.content,
                });
              }
            }
          }
        }

        const body = { text, html };
        await emailRepo.saveBody(emailId, body);
        return body;

      } finally {
        lock.release();
      }
    },

    async disconnect(accountId) {
      if (accountId === 0) {
        // Disconnect all
        for (const [id, conn] of connections.entries()) {
          try { await conn.client.logout(); } catch {}
          connections.delete(id);
        }
        clearInterval(cleanupInterval);
        return;
      }
      const conn = connections.get(accountId);
      if (conn) {
        try { await conn.client.logout(); } catch {}
        connections.delete(accountId);
      }
    },

    async cancel(accountId) {
      // Abort any in-progress sync
      const controller = abortControllers.get(accountId);
      if (controller) {
        controller.abort();
        abortControllers.delete(accountId);
      }

      // Close connection
      const conn = connections.get(accountId);
      if (conn) {
        try {
          await conn.client.logout();
        } catch {
          // Ignore logout errors during cancel
        }
        connections.delete(accountId);
      }
    },

    onProgress(cb) {
      progressCallbacks.push(cb);
      return () => {
        const idx = progressCallbacks.indexOf(cb);
        if (idx >= 0) progressCallbacks.splice(idx, 1);
      };
    },

    async testConnection(host, port, username, password) {
      // Test-only: connect and disconnect without any database operations
      const client = new ImapFlow({
        host,
        port,
        secure: port === 993,
        auth: { user: username, pass: password },
        logger: false,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      try {
        await client.connect();
        await client.logout();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    getDefaultFolders(imapHost: string) {
      const folders = getProviderFolders(imapHost);
      return [folders.inbox, folders.sent];
    },

    async listFolders(account: Account) {
      const client = await getConnection(account);
      const mailboxes = await client.list();
      return mailboxes.map(m => ({
        path: m.path,
        specialUse: m.specialUse,
      }));
    },

    async appendToSent(account: Account, message: SentMessage) {
      // Skip for providers that auto-save sent mail (Gmail, Outlook)
      // to avoid duplicates in the Sent folder
      const provider = getProviderFromHost(account.imapHost);
      if (PROVIDERS_WITH_AUTO_SENT.has(provider)) {
        return;
      }

      // Build RFC822 message using nodemailer's stream transport
      const transporter = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: 'unix',
      });

      const mailOptions = {
        from: message.from,
        to: message.to.join(', '),
        cc: message.cc?.join(', '),
        bcc: message.bcc?.join(', '),
        subject: message.subject,
        text: message.text,
        html: message.html,
        inReplyTo: message.inReplyTo,
        references: message.references?.join(' '),
        attachments: message.attachments?.map(a => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'base64'),
          contentType: a.contentType,
        })),
      };

      const info = await transporter.sendMail(mailOptions);
      const rawMessage = info.message as Buffer;

      // Get the provider-specific Sent folder path
      const folders = getProviderFolders(account.imapHost);
      const sentFolder = folders.sent;

      // Connect and append to Sent folder
      const client = await getConnection(account);
      await client.append(sentFolder, rawMessage, ['\\Seen']);
    },
  };
}

// ============================================
// IMAP Folder Operations (for Triage)
// ============================================

export function createImapFolderOps(
  secrets: SecureStorage
): ImapFolderOps {
  const connections = new Map<number, { client: ImapFlow; lastUsed: number }>();

  async function getConnection(account: Account): Promise<ImapFlow> {
    const existing = connections.get(account.id);
    if (existing?.client?.usable) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    const password = await secrets.getPassword(account.email);
    if (!password) throw new Error(`No password for account ${account.email}`);

    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapPort === 993,
      auth: { user: account.username, pass: password },
      logger: false,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    await client.connect();
    connections.set(account.id, { client, lastUsed: Date.now() });
    return client;
  }

  return {
    async createFolder(account: Account, path: string): Promise<void> {
      const client = await getConnection(account);
      await client.mailboxCreate(path);
    },

    async deleteFolder(account: Account, path: string): Promise<void> {
      const client = await getConnection(account);
      await client.mailboxDelete(path);
    },

    async listFolders(account: Account): Promise<{ path: string; specialUse?: string }[]> {
      const client = await getConnection(account);
      const mailboxes = await client.list();
      return mailboxes.map(m => ({
        path: m.path,
        specialUse: m.specialUse,
      }));
    },

    async moveMessage(account: Account, emailUid: number, fromFolder: string, toFolder: string): Promise<void> {
      const client = await getConnection(account);
      const lock = await client.getMailboxLock(fromFolder);
      try {
        await client.messageMove(emailUid.toString(), toFolder, { uid: true });
      } finally {
        lock.release();
      }
    },

    async moveToTrash(account: Account, emailUid: number, fromFolder: string): Promise<string> {
      const folders = getProviderFolders(account.imapHost);
      const trashPath = folders.trash;

      const client = await getConnection(account);
      const lock = await client.getMailboxLock(fromFolder);
      try {
        await client.messageMove(emailUid.toString(), trashPath, { uid: true });
      } finally {
        lock.release();
      }

      return trashPath;
    },

    async ensureTriageFolders(account: Account): Promise<string[]> {
      // Folders to create (excluding INBOX which always exists)
      const foldersToCreate = TRIAGE_FOLDERS.filter(f => f !== 'INBOX');

      // Also need parent folder Paper-Trail
      const allFolders = ['Paper-Trail', ...foldersToCreate];

      const client = await getConnection(account);
      const existing = await client.list();
      const existingPaths = new Set(existing.map(f => f.path));
      const created: string[] = [];

      for (const folder of allFolders) {
        if (!existingPaths.has(folder)) {
          try {
            await client.mailboxCreate(folder);
            created.push(folder);
          } catch (e) {
            // Folder might already exist or creation failed
            console.warn(`Failed to create folder ${folder}:`, e);
          }
        }
      }

      return created;
    },
  };
}
