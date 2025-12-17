/**
 * Classification State Repository Tests
 *
 * Tests for data consistency between getStats() and listPendingReview()
 * Issue #52: Pending Review count must match review list length
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { initDb, closeDb, createEmailRepo, createAccountRepo, createFolderRepo } from './index';
import { createClassificationStateRepo } from './classification-state';
import type { Email, ClassificationStatus } from '../../core/domain';

const TEST_DB_PATH = path.join(__dirname, 'test-classification-state.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

describe('Classification State Repository', () => {
  let classificationState: ReturnType<typeof createClassificationStateRepo>;
  let emailRepo: ReturnType<typeof createEmailRepo>;
  let accountId: number;
  let folderId: number;
  let testEmailIds: number[] = [];

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Initialize fresh database with schema
    const db = initDb(TEST_DB_PATH, SCHEMA_PATH);
    classificationState = createClassificationStateRepo(() => db);
    emailRepo = createEmailRepo();

    // Create test account and folder
    const accountRepo = createAccountRepo();
    const account = await accountRepo.create({
      name: 'Test',
      email: 'test@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      username: 'test',
      isActive: true,
    });
    accountId = account.id;

    const folderRepo = createFolderRepo();
    const folder = await folderRepo.getOrCreate(accountId, 'INBOX', 'Inbox', null);
    folderId = folder.id;

    testEmailIds = [];
  });

  afterEach(() => {
    closeDb();

    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Clean up WAL files
    const walPath = TEST_DB_PATH + '-wal';
    const shmPath = TEST_DB_PATH + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  async function createTestEmail(subject: string): Promise<number> {
    const email = await emailRepo.insert({
      messageId: `<${Date.now()}-${Math.random()}@test.com>`,
      accountId,
      folderId,
      uid: Date.now(),
      subject,
      from: { address: 'sender@example.com', name: 'Sender' },
      to: [],
      date: new Date(),
      snippet: 'Test snippet',
      sizeBytes: 100,
      isRead: false,
      isStarred: false,
      hasAttachments: false,
      bodyFetched: false,
    });
    testEmailIds.push(email.id);
    return email.id;
  }

  describe('getStats().pendingReview and listPendingReview() consistency', () => {
    it('pendingReview count must match listPendingReview length when emails are pending_review', async () => {
      // Create 3 emails with pending_review status
      for (let i = 0; i < 3; i++) {
        const emailId = await createTestEmail(`Pending Review Email ${i}`);
        await classificationState.setState({
          emailId,
          status: 'pending_review',
          confidence: 0.6,
          priority: 'normal',
          suggestedFolder: 'Planning',
          reasoning: 'Low confidence classification',
          classifiedAt: new Date(),
        });
      }

      const stats = await classificationState.getStats(accountId);
      const list = await classificationState.listPendingReview({ accountId });

      expect(stats.pendingReview).toBe(list.length);
      expect(stats.pendingReview).toBe(3);
    });

    it('pendingReview count must match listPendingReview length when emails are classified (high confidence)', async () => {
      // Create 5 emails with classified status (high confidence auto-tagged)
      for (let i = 0; i < 5; i++) {
        const emailId = await createTestEmail(`Classified Email ${i}`);
        await classificationState.setState({
          emailId,
          status: 'classified',
          confidence: 0.92,
          priority: 'normal',
          suggestedFolder: 'Planning',
          reasoning: 'High confidence classification',
          classifiedAt: new Date(),
        });
      }

      const stats = await classificationState.getStats(accountId);
      const list = await classificationState.listPendingReview({ accountId });

      // CRITICAL: These two must match for the UI to be consistent
      // Issue #52: Dashboard shows count X but Review view shows different count
      expect(stats.pendingReview).toBe(list.length);
    });

    it('pendingReview count must match listPendingReview length with mixed statuses', async () => {
      // Create mix of pending_review and classified emails
      for (let i = 0; i < 3; i++) {
        const emailId = await createTestEmail(`Pending Email ${i}`);
        await classificationState.setState({
          emailId,
          status: 'pending_review',
          confidence: 0.5,
          priority: 'normal',
          suggestedFolder: 'Planning',
          reasoning: 'Low confidence',
          classifiedAt: new Date(),
        });
      }

      for (let i = 0; i < 7; i++) {
        const emailId = await createTestEmail(`Classified Email ${i}`);
        await classificationState.setState({
          emailId,
          status: 'classified',
          confidence: 0.95,
          priority: 'high',
          suggestedFolder: 'Review',
          reasoning: 'High confidence',
          classifiedAt: new Date(),
        });
      }

      // Also add some accepted/dismissed emails that should NOT be counted
      for (let i = 0; i < 2; i++) {
        const emailId = await createTestEmail(`Accepted Email ${i}`);
        await classificationState.setState({
          emailId,
          status: 'accepted',
          confidence: 0.9,
          priority: 'normal',
          suggestedFolder: 'Archive',
          reasoning: 'Accepted by user',
          classifiedAt: new Date(),
          reviewedAt: new Date(),
        });
      }

      const stats = await classificationState.getStats(accountId);
      const list = await classificationState.listPendingReview({ accountId });

      // The counts MUST match for UI consistency
      expect(stats.pendingReview).toBe(list.length);
      // accepted emails should NOT be in the count or list
      expect(list.every(item => item.status !== 'accepted')).toBe(true);
    });

    it('pendingReview count should be 0 when all emails are accepted or dismissed', async () => {
      // Create emails that are all processed
      for (let i = 0; i < 4; i++) {
        const emailId = await createTestEmail(`Processed Email ${i}`);
        await classificationState.setState({
          emailId,
          status: i < 2 ? 'accepted' : 'dismissed',
          confidence: 0.85,
          priority: 'normal',
          suggestedFolder: 'Planning',
          reasoning: 'User processed',
          classifiedAt: new Date(),
          reviewedAt: i < 2 ? new Date() : undefined,
          dismissedAt: i >= 2 ? new Date() : undefined,
        });
      }

      const stats = await classificationState.getStats(accountId);
      const list = await classificationState.listPendingReview({ accountId });

      expect(stats.pendingReview).toBe(0);
      expect(list.length).toBe(0);
    });
  });
});
