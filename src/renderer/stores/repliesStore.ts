/**
 * "Needs your reply" state.
 *
 * One source of truth for the sidebar count and the NeedsReplyView: the whole
 * `replies.list()` payload (one result per account). Actions are optimistic —
 * the item disappears immediately and is put back where it was if the call
 * fails.
 *
 * Imported directly where used (not re-exported from ./index).
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { ForgottenReply, ForgottenRepliesResult } from '../../core/domain';

/** How long "Snooze 1 day" snoozes for. */
export const SNOOZE_HOURS = 24;

/** The sidebar count is refreshed this often while the app is open. */
export const REPLIES_REFRESH_MS = 15 * 60 * 1000;

type LoadOptions = {
  /** Start a fresh request even if one is already in flight. */
  force?: boolean;
};

type RepliesStore = {
  results: ForgottenRepliesResult[];
  /** True once a list has been received (stale data stays on screen while refreshing). */
  loaded: boolean;
  loading: boolean;
  /** Last failed load, cleared by the next successful one. */
  error: string | null;
  /** Last failed action (done / snooze / dismiss), after rollback. */
  actionError: string | null;

  load: (opts?: LoadOptions) => Promise<void>;
  /** Each action resolves `true` on success and `false` after a rollback. */
  done: (emailId: number) => Promise<boolean>;
  snooze: (emailId: number, hours?: number) => Promise<boolean>;
  dismiss: (emailId: number) => Promise<boolean>;
  clearActionError: () => void;
};

type Removed = {
  accountId: number;
  index: number;
  item: ForgottenReply;
};

// Email ids with an action in flight. A refresh that lands meanwhile must not
// bring them back (the server may not have caught up yet).
const inFlight = new Set<number>();
let loadSeq = 0;
let pendingLoad: Promise<void> | null = null;

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const withoutInFlight = (results: ForgottenRepliesResult[]): ForgottenRepliesResult[] =>
  inFlight.size === 0
    ? results
    : results.map((r) => ({ ...r, items: r.items.filter((i) => !inFlight.has(i.emailId)) }));

function remove(
  results: ForgottenRepliesResult[],
  emailId: number,
): { results: ForgottenRepliesResult[]; removed: Removed | null } {
  for (const result of results) {
    const index = result.items.findIndex((i) => i.emailId === emailId);
    const item = result.items[index];
    if (!item) continue;
    return {
      removed: { accountId: result.accountId, index, item },
      results: results.map((r) =>
        r === result ? { ...r, items: r.items.filter((i) => i.emailId !== emailId) } : r,
      ),
    };
  }
  return { results, removed: null };
}

function restore(results: ForgottenRepliesResult[], removed: Removed): ForgottenRepliesResult[] {
  return results.map((r) => {
    if (r.accountId !== removed.accountId) return r;
    if (r.items.some((i) => i.emailId === removed.item.emailId)) return r;
    const items = [...r.items];
    items.splice(Math.min(removed.index, items.length), 0, removed.item);
    return { ...r, items };
  });
}

type SetState = (partial: Partial<RepliesStore>) => void;

/** One `replies.list()` round trip; ignored if a newer request has superseded it. */
async function fetchReplies(seq: number, set: SetState): Promise<void> {
  try {
    const results = await window.mailApi.replies.list();
    if (seq !== loadSeq) return;
    set({ results: withoutInFlight(results), loaded: true, loading: false, error: null });
  } catch (err) {
    if (seq !== loadSeq) return;
    set({ loading: false, error: errorMessage(err) });
  }
}

export const useRepliesStore = create<RepliesStore>((set, get) => {
  const act = async (
    emailId: number,
    call: () => Promise<void>,
    failure: string,
  ): Promise<boolean> => {
    const { results, removed } = remove(get().results, emailId);
    if (!removed) return false;

    inFlight.add(emailId);
    // Any list request started before this action may still contain the item;
    // drop its response rather than let it undo the removal.
    loadSeq++;
    pendingLoad = null;
    set({ results, actionError: null, loading: false });
    try {
      await call();
      return true;
    } catch (err) {
      console.error(`Needs-reply action failed for email ${emailId}:`, err);
      set((s) => ({ results: restore(s.results, removed), actionError: failure }));
      return false;
    } finally {
      inFlight.delete(emailId);
    }
  };

  return {
    results: [],
    loaded: false,
    loading: false,
    error: null,
    actionError: null,

    load: (opts = {}) => {
      if (pendingLoad && !opts.force) return pendingLoad;

      const seq = ++loadSeq;
      set({ loading: true, error: null });
      const request: Promise<void> = fetchReplies(seq, set).finally(() => {
        if (pendingLoad === request) pendingLoad = null;
      });
      pendingLoad = request;
      return request;
    },

    done: (emailId) =>
      act(emailId, () => window.mailApi.replies.done(emailId), "Couldn't mark that as done."),

    snooze: (emailId, hours = SNOOZE_HOURS) =>
      act(
        emailId,
        () => window.mailApi.replies.snooze(emailId, hours),
        "Couldn't snooze that email.",
      ),

    dismiss: (emailId) =>
      act(
        emailId,
        () => window.mailApi.replies.dismiss(emailId),
        "Couldn't mark that as not important.",
      ),

    clearActionError: () => set({ actionError: null }),
  };
});

/** Total number of emails waiting for a reply, across accounts. */
export const selectReplyCount = (state: Pick<RepliesStore, 'results'>): number =>
  state.results.reduce((total, r) => total + r.items.length, 0);

/**
 * Keeps the shared list (and so the sidebar count) fresh: loads on mount and
 * then every `intervalMs`, cleaning up on unmount.
 */
export function useReplyCountRefresh(intervalMs: number = REPLIES_REFRESH_MS): void {
  useEffect(() => {
    const refresh = () => {
      void useRepliesStore.getState().load();
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
