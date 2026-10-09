/**
 * Tests for repliesStore: shared "Needs your reply" state behind the sidebar
 * count and the NeedsReplyView.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useRepliesStore,
  selectReplyCount,
  useReplyCountRefresh,
  REPLIES_REFRESH_MS,
} from './repliesStore';
import type { ForgottenReply, ForgottenRepliesResult } from '../../core/domain';

function makeReply(emailId: number, accountId = 1): ForgottenReply {
  return {
    emailId,
    accountId,
    from: { address: `s${emailId}@example.com`, name: null },
    subject: `Subject ${emailId}`,
    date: new Date('2026-01-01T10:00:00Z'),
    ageHours: 48,
    folderPath: 'INBOX',
    needsReply: 0.9,
    importance: 3,
    score: 1,
    basis: 'signal',
    signalSource: 'system2',
    reason: 'Asked you a question',
  };
}

function makeResult(accountId: number, ids: number[]): ForgottenRepliesResult {
  return {
    accountId,
    accountEmail: `acct${accountId}@example.com`,
    items: ids.map((id) => makeReply(id, accountId)),
    sentHealth: 'ok',
    generatedAt: new Date(),
  };
}

function installReplies(results: ForgottenRepliesResult[]) {
  const replies = {
    list: vi.fn().mockResolvedValue(results),
    done: vi.fn().mockResolvedValue(undefined),
    snooze: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn().mockResolvedValue(undefined),
    backfill: vi.fn().mockResolvedValue({ processed: 0, skipped: 0 }),
  };
  (window as any).mailApi.replies = replies;
  return replies;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useRepliesStore.setState({
    results: [],
    loaded: false,
    loading: false,
    error: null,
    actionError: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repliesStore', () => {
  it('counts items across all accounts', async () => {
    installReplies([makeResult(1, [1, 2]), makeResult(2, [3])]);
    await useRepliesStore.getState().load();

    expect(selectReplyCount(useRepliesStore.getState())).toBe(3);
    expect(useRepliesStore.getState().loaded).toBe(true);
  });

  it('keeps showing the last good data when a refresh fails', async () => {
    const replies = installReplies([makeResult(1, [1])]);
    await useRepliesStore.getState().load();
    replies.list.mockRejectedValueOnce(new Error('offline'));
    await useRepliesStore.getState().load();

    const state = useRepliesStore.getState();
    expect(selectReplyCount(state)).toBe(1);
    expect(state.error).toMatch(/offline/);
  });

  it('applies only the most recent load when loads overlap', async () => {
    let resolveFirst!: (v: ForgottenRepliesResult[]) => void;
    const replies = installReplies([]);
    replies.list
      .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
      .mockResolvedValueOnce([makeResult(1, [1, 2, 3])]);

    const first = useRepliesStore.getState().load();
    await useRepliesStore.getState().load({ force: true });
    resolveFirst([makeResult(1, [1])]);
    await first;

    expect(selectReplyCount(useRepliesStore.getState())).toBe(3);
  });

  it('ignores a list response that was requested before an action and lands after it', async () => {
    const replies = installReplies([makeResult(1, [1, 2])]);
    await useRepliesStore.getState().load();

    // A refresh starts (the server still lists email 2)...
    let resolveStale!: (v: ForgottenRepliesResult[]) => void;
    replies.list.mockImplementationOnce(() => new Promise((res) => (resolveStale = res)));
    const refresh = useRepliesStore.getState().load();
    // ...the user finishes email 2 and the call succeeds...
    await useRepliesStore.getState().done(2);
    // ...and only then does the stale response arrive.
    resolveStale([makeResult(1, [1, 2])]);
    await refresh;

    expect(useRepliesStore.getState().results[0]?.items.map((i) => i.emailId)).toEqual([1]);
  });

  it('removes optimistically and restores at the original index on failure', async () => {
    const replies = installReplies([makeResult(1, [1, 2, 3])]);
    replies.snooze.mockRejectedValue(new Error('nope'));
    await useRepliesStore.getState().load();

    const pending = useRepliesStore.getState().snooze(2);
    expect(useRepliesStore.getState().results[0]?.items.map((i) => i.emailId)).toEqual([1, 3]);
    const ok = await pending;

    expect(ok).toBe(false);
    expect(useRepliesStore.getState().results[0]?.items.map((i) => i.emailId)).toEqual([1, 2, 3]);
    expect(useRepliesStore.getState().actionError).toBeTruthy();
    expect(replies.snooze).toHaveBeenCalledWith(2, 24);
  });

  describe('useReplyCountRefresh', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('loads on mount and every 15 minutes, and stops on unmount', async () => {
      const replies = installReplies([makeResult(1, [1])]);
      const { unmount } = renderHook(() => useReplyCountRefresh());
      await act(async () => {});
      expect(replies.list).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(REPLIES_REFRESH_MS);
      });
      expect(replies.list).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(REPLIES_REFRESH_MS);
      });
      expect(replies.list).toHaveBeenCalledTimes(3);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REPLIES_REFRESH_MS * 2);
      });
      expect(replies.list).toHaveBeenCalledTimes(3);
    });

    it('refreshes every 15 minutes', () => {
      expect(REPLIES_REFRESH_MS).toBe(15 * 60 * 1000);
    });
  });
});
