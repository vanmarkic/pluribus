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
    it('returns array of folder names to sync', () => {
      const sync = createMailSync(
        createMockEmailRepo(),
        createMockAttachmentRepo(),
        createMockFolderRepo(),
        createMockSecrets()
      );

      const folders = sync.getDefaultFolders();

      expect(Array.isArray(folders)).toBe(true);
      expect(folders.length).toBeGreaterThan(0);
      expect(folders).toContain('INBOX');
    });
  });
});
