/**
 * Shared test helper utilities
 */

import type { Email } from '../core/domain';

/**
 * Create a test email with all required fields.
 * Pass overrides to customize specific fields.
 */
export function createTestEmail(id: number, overrides: Partial<Email> = {}): Email {
  return {
    id,
    accountId: 1,
    folderId: 1,
    uid: id,
    messageId: `msg-${id}`,
    subject: `Test Email ${id}`,
    from: { address: `sender${id}@test.com`, name: `Sender ${id}` },
    to: [`recipient${id}@test.com`],
    date: new Date(),
    snippet: `Snippet for email ${id}`,
    sizeBytes: 1000,
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    bodyFetched: false,
    // Threading
    inReplyTo: null,
    references: null,
    threadId: null,
    // Awaiting reply
    awaitingReply: false,
    awaitingReplySince: null,
    // Unsubscribe
    listUnsubscribe: null,
    listUnsubscribePost: null,
    ...overrides,
  };
}

/**
 * Create email input data (without id) for insert operations.
 * All fields are included, defaulting new fields to null/false.
 */
export function createTestEmailInput(
  uid: number,
  overrides: Partial<Omit<Email, 'id'>> = {}
): Omit<Email, 'id'> {
  return {
    accountId: 1,
    folderId: 1,
    uid,
    messageId: `msg-${uid}`,
    subject: `Test Email ${uid}`,
    from: { address: `sender${uid}@test.com`, name: `Sender ${uid}` },
    to: [`recipient${uid}@test.com`],
    date: new Date(),
    snippet: `Snippet for email ${uid}`,
    sizeBytes: 1000,
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    bodyFetched: false,
    // Threading
    inReplyTo: null,
    references: null,
    threadId: null,
    // Awaiting reply
    awaitingReply: false,
    awaitingReplySince: null,
    // Unsubscribe
    listUnsubscribe: null,
    listUnsubscribePost: null,
    ...overrides,
  };
}
