/**
 * Background Task Manager
 *
 * Manages async tasks with progress tracking.
 * Tasks run in-process but don't block IPC responses.
 */

import type { BackgroundTaskManager, TaskState, TaskStatus } from '../../core/ports';

export function createBackgroundTaskManager(): BackgroundTaskManager {
  const tasks = new Map<string, TaskState>();

  return {
    start(id: string, total: number, fn: (onProgress: () => void) => Promise<void>) {
      // Initialize task state
      tasks.set(id, { status: 'running', processed: 0, total });

      // Progress callback increments processed count
      const onProgress = () => {
        const task = tasks.get(id);
        if (task && task.status === 'running') {
          task.processed++;
        }
      };

      // Run async (don't await - fire and forget)
      fn(onProgress)
        .then(() => {
          const task = tasks.get(id);
          if (task) {
            task.status = 'completed';
            task.processed = task.total; // Ensure 100% on completion
          }
        })
        .catch((err) => {
          const task = tasks.get(id);
          if (task) {
            task.status = 'failed';
            task.error = err instanceof Error ? err.message : String(err);
          }
        });
    },

    getStatus(id: string): TaskState | null {
      const task = tasks.get(id);
      return task ? { ...task } : null;
    },

    clear(id: string): void {
      tasks.delete(id);
    },
  };
}

// Re-export types for convenience
export type { BackgroundTaskManager, TaskState, TaskStatus };
