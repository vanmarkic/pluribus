// src/adapters/send-queue/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSendQueue } from './index';

describe('sendQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queue', () => {
    it('returns queue id and expiration time', () => {
      const queue = createSendQueue({ delayMs: 10000 });
      const draft = { to: ['test@test.com'], subject: 'Test', body: 'Hello' };

      const result = queue.queue(1, draft);

      expect(result.id).toBeDefined();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('calls onSend after delay expires', async () => {
      const onSend = vi.fn().mockResolvedValue({ messageId: '<sent>' });
      const queue = createSendQueue({ delayMs: 10000, onSend });
      const draft = { to: ['test@test.com'], subject: 'Test', body: 'Hello' };

      queue.queue(1, draft);

      expect(onSend).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10000);
      await Promise.resolve(); // flush promises

      expect(onSend).toHaveBeenCalledWith(1, draft);
    });
  });

  describe('cancel', () => {
    it('prevents send when cancelled before expiry', async () => {
      const onSend = vi.fn();
      const queue = createSendQueue({ delayMs: 10000, onSend });
      const draft = { to: ['test@test.com'], subject: 'Test', body: 'Hello' };

      const { id } = queue.queue(1, draft);

      const cancelled = queue.cancel(id);
      expect(cancelled).toBe(true);

      vi.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(onSend).not.toHaveBeenCalled();
    });

    it('returns false for unknown id', () => {
      const queue = createSendQueue({ delayMs: 10000 });

      const cancelled = queue.cancel('unknown-id');

      expect(cancelled).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns pending status for queued item', () => {
      const queue = createSendQueue({ delayMs: 10000 });
      const draft = { to: ['test@test.com'], subject: 'Test', body: 'Hello' };

      const { id } = queue.queue(1, draft);
      const status = queue.getStatus(id);

      expect(status?.status).toBe('pending');
      expect(status?.draft).toEqual(draft);
    });

    it('returns null for unknown id', () => {
      const queue = createSendQueue({ delayMs: 10000 });

      const status = queue.getStatus('unknown');

      expect(status).toBeNull();
    });
  });
});
