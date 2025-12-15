import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackgroundTaskManager } from './index';

describe('BackgroundTaskManager', () => {
  describe('start', () => {
    it('initializes task state with running status', () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 10, async () => {});

      const status = manager.getStatus('task-1');
      expect(status).toEqual({
        status: 'running',
        processed: 0,
        total: 10,
      });
    });

    it('increments processed count on progress callback', async () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 3, async (onProgress) => {
        onProgress();
        onProgress();
        onProgress();
      });

      // Wait for async function to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const status = manager.getStatus('task-1');
      expect(status?.processed).toBe(3);
    });

    it('sets status to completed when function resolves', async () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 5, async (onProgress) => {
        onProgress();
        onProgress();
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const status = manager.getStatus('task-1');
      expect(status?.status).toBe('completed');
      expect(status?.processed).toBe(5); // Ensures 100% on completion
    });

    it('sets status to failed with error message when function rejects', async () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 5, async () => {
        throw new Error('Something went wrong');
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const status = manager.getStatus('task-1');
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('Something went wrong');
    });

    it('handles non-Error thrown values', async () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 5, async () => {
        throw 'string error';
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const status = manager.getStatus('task-1');
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('string error');
    });

    it('does not increment progress after task fails', async () => {
      const manager = createBackgroundTaskManager();
      let progressCallback: (() => void) | null = null;

      manager.start('task-1', 10, async (onProgress) => {
        progressCallback = onProgress;
        onProgress(); // processed = 1
        throw new Error('Fail');
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to call progress after failure
      progressCallback?.();

      const status = manager.getStatus('task-1');
      expect(status?.status).toBe('failed');
      // Progress should not have incremented after failure
      expect(status?.processed).toBe(1);
    });

    it('supports multiple concurrent tasks', async () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 5, async (onProgress) => {
        for (let i = 0; i < 5; i++) onProgress();
      });

      manager.start('task-2', 3, async (onProgress) => {
        for (let i = 0; i < 3; i++) onProgress();
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(manager.getStatus('task-1')?.processed).toBe(5);
      expect(manager.getStatus('task-2')?.processed).toBe(3);
    });
  });

  describe('getStatus', () => {
    it('returns null for non-existent task', () => {
      const manager = createBackgroundTaskManager();

      const status = manager.getStatus('nonexistent');

      expect(status).toBeNull();
    });

    it('returns a copy of task state (immutable)', () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 10, async () => {});

      const status1 = manager.getStatus('task-1');
      const status2 = manager.getStatus('task-1');

      // Should be equal but not the same reference
      expect(status1).toEqual(status2);
      expect(status1).not.toBe(status2);

      // Mutating returned object should not affect internal state
      if (status1) {
        status1.processed = 999;
      }
      expect(manager.getStatus('task-1')?.processed).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes task from manager', () => {
      const manager = createBackgroundTaskManager();

      manager.start('task-1', 10, async () => {});
      expect(manager.getStatus('task-1')).not.toBeNull();

      manager.clear('task-1');
      expect(manager.getStatus('task-1')).toBeNull();
    });

    it('does nothing for non-existent task', () => {
      const manager = createBackgroundTaskManager();

      // Should not throw
      manager.clear('nonexistent');
    });
  });
});
