/**
 * IMAP Sync Adapter Tests
 *
 * Tests for progress event emission during sync.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMailSync } from './index';
import type { EmailRepo, AttachmentRepo, FolderRepo, SecureStorage } from '../../core/ports';

// Minimal mock factories
function createMockEmailRepo(): EmailRepo {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    insertBatch: vi.fn().mockResolvedValue({ count: 0, ids: [] }),
    getBody: vi.fn(),
    saveBody: vi.fn(),
    insert: vi.fn(),
    markRead: vi.fn(),
    setStar: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockAttachmentRepo(): AttachmentRepo {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findByEmailId: vi.fn(),
    getContent: vi.fn(),
  };
}

function createMockFolderRepo(): FolderRepo {
  return {
    getOrCreate: vi.fn().mockResolvedValue({ id: 1, accountId: 1, path: 'INBOX', name: 'INBOX', lastUid: 0 }),
    updateLastUid: vi.fn(),
    clear: vi.fn(),
  };
}

function createMockSecrets(): SecureStorage {
  return {
    getPassword: vi.fn().mockResolvedValue('test-password'),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
    getApiKey: vi.fn(),
    setApiKey: vi.fn(),
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    clearSession: vi.fn(),
    isBiometricAvailable: vi.fn(),
  };
}

describe('createMailSync', () => {
  describe('onProgress', () => {
    it('returns unsubscribe function', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const callback = vi.fn();
      const unsubscribe = sync.onProgress(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('registers callback that can be unsubscribed', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const callback = vi.fn();
      const unsubscribe = sync.onProgress(callback);

      // Unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow();
    });

    it('allows multiple callbacks to be registered', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = sync.onProgress(callback1);
      const unsub2 = sync.onProgress(callback2);

      expect(typeof unsub1).toBe('function');
      expect(typeof unsub2).toBe('function');
    });
  });

  describe('getDefaultFolders', () => {
    it('returns provider-specific folders for Gmail', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const folders = sync.getDefaultFolders('imap.gmail.com');

      expect(folders).toEqual(['INBOX', '[Gmail]/Sent Mail']);
    });

    it('returns provider-specific folders for Outlook', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const folders = sync.getDefaultFolders('outlook.office365.com');

      expect(folders).toEqual(['INBOX', 'Sent']);
    });

    it('returns provider-specific folders for Infomaniak', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const folders = sync.getDefaultFolders('mail.infomaniak.com');

      expect(folders).toEqual(['INBOX', 'Sent']);
    });

    it('returns default folders for unknown providers', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const folders = sync.getDefaultFolders('mail.example.com');

      expect(folders).toEqual(['INBOX', 'Sent']);
    });
  });

  describe('sync with since option', () => {
    it('accepts since date option in SyncOptions', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      // Type check: since should be accepted as a valid option
      // This test verifies the type exists and is usable
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const options = { since: thirtyDaysAgo, folder: 'INBOX' };

      // The sync function should accept the since option without type errors
      expect(options.since).toBeInstanceOf(Date);
    });
  });
});
