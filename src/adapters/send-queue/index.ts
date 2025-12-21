// src/adapters/send-queue/index.ts
import { randomUUID } from 'crypto';

export type DraftInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
};

type QueuedSend = {
  id: string;
  accountId: number;
  draft: DraftInput;
  expiresAt: Date;
  timer: NodeJS.Timeout;
  status: 'pending' | 'sending' | 'sent' | 'cancelled';
};

type SendQueueOptions = {
  delayMs: number;
  onSend?: (accountId: number, draft: DraftInput) => Promise<{ messageId: string }>;
  onSent?: (id: string, messageId: string) => void;
  onError?: (id: string, error: Error) => void;
};

export type SendQueue = {
  queue(accountId: number, draft: DraftInput): { id: string; expiresAt: Date };
  cancel(id: string): boolean;
  getStatus(id: string): { status: string; draft: DraftInput; expiresAt: Date } | null;
};

export function createSendQueue(options: SendQueueOptions): SendQueue {
  const { delayMs, onSend, onSent, onError } = options;
  const pending = new Map<string, QueuedSend>();

  async function executeSend(id: string) {
    const queued = pending.get(id);
    if (!queued || queued.status !== 'pending') return;

    queued.status = 'sending';

    try {
      if (onSend) {
        const result = await onSend(queued.accountId, queued.draft);
        queued.status = 'sent';
        onSent?.(id, result.messageId);
      }
    } catch (err) {
      onError?.(id, err as Error);
    } finally {
      pending.delete(id);
    }
  }

  return {
    queue(accountId: number, draft: DraftInput) {
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + delayMs);

      const timer = setTimeout(() => executeSend(id), delayMs);

      pending.set(id, {
        id,
        accountId,
        draft,
        expiresAt,
        timer,
        status: 'pending',
      });

      return { id, expiresAt };
    },

    cancel(id: string) {
      const queued = pending.get(id);
      if (!queued || queued.status !== 'pending') return false;

      clearTimeout(queued.timer);
      queued.status = 'cancelled';
      pending.delete(id);
      return true;
    },

    getStatus(id: string) {
      const queued = pending.get(id);
      if (!queued) return null;

      return {
        status: queued.status,
        draft: queued.draft,
        expiresAt: queued.expiresAt,
      };
    },
  };
}
