/**
 * Tests for NeedsReplyView ("Needs your reply").
 *
 * The real zustand stores are used (repliesStore, emailUiStore, uiStore);
 * only window.mailApi and the heavy EmailViewer pane are stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NeedsReplyView } from './NeedsReplyView';
import { useRepliesStore } from '../stores/repliesStore';
import { useEmailUiStore } from '../stores';
import type { ForgottenReply, ForgottenRepliesResult } from '../../core/domain';

vi.mock('./EmailViewer', () => ({
  EmailViewer: () => <div data-testid="email-viewer" />,
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function makeReply(overrides: Partial<ForgottenReply> = {}): ForgottenReply {
  const id = overrides.emailId ?? 1;
  return {
    emailId: id,
    accountId: 1,
    from: { address: `sender${id}@example.com`, name: `Sender ${id}` },
    subject: `Subject ${id}`,
    date: new Date(Date.now() - 3 * DAY_MS),
    ageHours: 72,
    folderPath: 'INBOX',
    needsReply: 0.9,
    importance: 3,
    score: 3,
    basis: 'signal',
    signalSource: 'system2',
    reason: `Reason ${id}`,
    ...overrides,
  };
}

function makeResult(
  items: ForgottenReply[],
  overrides: Partial<ForgottenRepliesResult> = {},
): ForgottenRepliesResult {
  return {
    accountId: 1,
    accountEmail: 'me@example.com',
    items,
    sentHealth: 'ok',
    generatedAt: new Date(),
    ...overrides,
  };
}

function installReplies(
  results: ForgottenRepliesResult[],
  overrides: Record<string, unknown> = {},
) {
  const replies = {
    list: vi.fn().mockResolvedValue(results),
    done: vi.fn().mockResolvedValue(undefined),
    snooze: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn().mockResolvedValue(undefined),
    backfill: vi.fn().mockResolvedValue({ processed: 0, skipped: 0 }),
    ...overrides,
  };
  (window as any).mailApi.replies = replies;
  return replies;
}

/** A promise the test resolves/rejects by hand (to observe optimistic state). */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const getRow = (emailId: number) =>
  document.querySelector<HTMLElement>(`[data-email-id="${emailId}"]`)!;

beforeEach(() => {
  // Failed actions are logged on purpose; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useRepliesStore.setState({
    results: [],
    loaded: false,
    loading: false,
    error: null,
    actionError: null,
  });
  useEmailUiStore.setState({ selectedId: null, focusedId: null, filter: {} });
  (window as any).mailApi.accounts = { list: vi.fn().mockResolvedValue([]) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NeedsReplyView', () => {
  describe('list', () => {
    it('renders the header and the items from the API', async () => {
      installReplies([
        makeResult([
          makeReply({
            emailId: 1,
            from: { address: 'ana@acme.com', name: 'Ana Costa' },
            subject: 'Quote for the Q3 rollout',
            importance: 4,
            reason: 'Asked you for a quote 3 days ago',
          }),
          makeReply({
            emailId: 2,
            from: { address: 'bob@acme.com', name: 'Bob' },
            subject: 'Rollout order',
            importance: 3,
            reason: 'Asked you a question 2 days ago',
          }),
        ]),
      ]);

      render(<NeedsReplyView />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Needs your reply' }),
      ).toBeInTheDocument();
      expect(screen.getByText("Emails you haven't answered yet")).toBeInTheDocument();

      expect(await screen.findByText('Ana Costa')).toBeInTheDocument();
      expect(screen.getByText('Quote for the Q3 rollout')).toBeInTheDocument();
      expect(screen.getByText('Asked you for a quote 3 days ago')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      // Relative age, via date-fns
      expect(screen.getAllByText('3 days ago')).toHaveLength(2);
      // Importance badges
      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('Important')).toBeInTheDocument();
      expect(window.mailApi.replies.list).toHaveBeenCalledTimes(1);
    });

    it('falls back to the sender address when there is no name', async () => {
      installReplies([
        makeResult([makeReply({ emailId: 1, from: { address: 'noname@acme.com', name: null } })]),
      ]);
      render(<NeedsReplyView />);
      expect(await screen.findByText('noname@acme.com')).toBeInTheDocument();
    });

    it('shows a Heuristic marker only for heuristic items', async () => {
      installReplies([
        makeResult([
          makeReply({ emailId: 1, basis: 'signal' }),
          makeReply({ emailId: 2, basis: 'heuristic', signalSource: null }),
        ]),
      ]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      expect(screen.getAllByText('Heuristic')).toHaveLength(1);
      expect(within(getRow(2)).getByText('Heuristic')).toBeInTheDocument();
      expect(within(getRow(1)).queryByText('Heuristic')).not.toBeInTheDocument();
    });

    it('shows no account headings with a single account', async () => {
      installReplies([makeResult([makeReply({ emailId: 1 })])]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');
      expect(screen.queryByText('me@example.com')).not.toBeInTheDocument();
    });

    it('groups by account when there is more than one account', async () => {
      installReplies([
        makeResult([makeReply({ emailId: 1, accountId: 1 })]),
        makeResult([makeReply({ emailId: 2, accountId: 2 })], {
          accountId: 2,
          accountEmail: 'work@corp.com',
        }),
      ]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      expect(screen.getByRole('heading', { name: /me@example\.com/ })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /work@corp\.com/ })).toBeInTheDocument();
    });

    it('shows a loading state until the list resolves', async () => {
      const d = deferred<ForgottenRepliesResult[]>();
      installReplies([], { list: vi.fn().mockReturnValue(d.promise) });
      render(<NeedsReplyView />);

      expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

      await act(async () => d.resolve([makeResult([makeReply({ emailId: 1 })])]));
      expect(await screen.findByText('Subject 1')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows an error state with a working retry', async () => {
      const list = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue([makeResult([makeReply({ emailId: 1 })])]);
      installReplies([], { list });
      const user = userEvent.setup();
      render(<NeedsReplyView />);

      expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load/i);
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('Subject 1')).toBeInTheDocument();
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  describe('opening an email', () => {
    it('selects the email in the reader when an item is clicked', async () => {
      installReplies([makeResult([makeReply({ emailId: 7, subject: 'Open me' })])]);
      const user = userEvent.setup();
      render(<NeedsReplyView />);

      await user.click(await screen.findByText('Open me'));

      expect(useEmailUiStore.getState().selectedId).toBe(7);
      expect(screen.getByTestId('email-viewer')).toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('Done calls replies.done with the email id and removes the item', async () => {
      const replies = installReplies([
        makeResult([makeReply({ emailId: 1 }), makeReply({ emailId: 2 })]),
      ]);
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      await user.click(within(getRow(1)).getByRole('button', { name: 'Done' }));

      expect(replies.done).toHaveBeenCalledWith(1);
      await waitFor(() => expect(screen.queryByText('Subject 1')).not.toBeInTheDocument());
      expect(screen.getByText('Subject 2')).toBeInTheDocument();
    });

    it('removes the item optimistically, before the API call settles', async () => {
      const d = deferred();
      installReplies([makeResult([makeReply({ emailId: 1 })])], {
        done: vi.fn().mockReturnValue(d.promise),
      });
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByText('Subject 1')).not.toBeInTheDocument();

      await act(async () => d.resolve());
      expect(screen.queryByText('Subject 1')).not.toBeInTheDocument();
    });

    it('Snooze 1 day calls replies.snooze(id, 24)', async () => {
      const replies = installReplies([makeResult([makeReply({ emailId: 5 })])]);
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await screen.findByText('Subject 5');

      await user.click(screen.getByRole('button', { name: 'Snooze 1 day' }));

      expect(replies.snooze).toHaveBeenCalledWith(5, 24);
      await waitFor(() => expect(screen.queryByText('Subject 5')).not.toBeInTheDocument());
    });

    it('Not important calls replies.dismiss with the email id', async () => {
      const replies = installReplies([makeResult([makeReply({ emailId: 9 })])]);
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await screen.findByText('Subject 9');

      await user.click(screen.getByRole('button', { name: 'Not important' }));

      expect(replies.dismiss).toHaveBeenCalledWith(9);
      await waitFor(() => expect(screen.queryByText('Subject 9')).not.toBeInTheDocument());
    });

    it.each([
      ['Done', 'done'],
      ['Snooze 1 day', 'snooze'],
      ['Not important', 'dismiss'],
    ])('rolls %s back when the API call rejects', async (label, method) => {
      const replies = installReplies(
        [makeResult([makeReply({ emailId: 1 }), makeReply({ emailId: 2 })])],
        { [method]: vi.fn().mockRejectedValue(new Error('nope')) },
      );
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      await user.click(within(getRow(1)).getByRole('button', { name: label }));

      // Item is back, in its original position, and the failure is surfaced.
      expect(await screen.findByText('Subject 1')).toBeInTheDocument();
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      const rows = Array.from(document.querySelectorAll('[data-email-id]')).map((el) =>
        el.getAttribute('data-email-id'),
      );
      expect(rows).toEqual(['1', '2']);
      expect((replies as any)[method]).toHaveBeenCalled();
    });

    it('deselects the reader when the open email is dismissed', async () => {
      installReplies([makeResult([makeReply({ emailId: 1 })])]);
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await user.click(await screen.findByText('Subject 1'));
      expect(useEmailUiStore.getState().selectedId).toBe(1);

      await user.click(screen.getByRole('button', { name: 'Done' }));

      expect(useEmailUiStore.getState().selectedId).toBeNull();
    });

    it('does not let a background refresh resurrect an item with an action in flight', async () => {
      const d = deferred();
      const item = makeReply({ emailId: 1 });
      installReplies([makeResult([item])], { done: vi.fn().mockReturnValue(d.promise) });
      const user = userEvent.setup();
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      await user.click(screen.getByRole('button', { name: 'Done' }));
      // A silent refresh (sidebar timer, sync) lands while the call is pending
      await act(async () => {
        await useRepliesStore.getState().load();
      });
      expect(screen.queryByText('Subject 1')).not.toBeInTheDocument();

      await act(async () => d.resolve());
    });
  });

  describe('keyboard', () => {
    it('e / s / x act on the focused item and do not leak to global shortcuts', async () => {
      const replies = installReplies([
        makeResult([
          makeReply({ emailId: 1 }),
          makeReply({ emailId: 2 }),
          makeReply({ emailId: 3 }),
        ]),
      ]);
      const globalHandler = vi.fn();
      window.addEventListener('keydown', globalHandler);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      const open = (id: number) => within(getRow(id)).getByRole('button', { name: /Subject/ });

      open(1).focus();
      fireEvent.keyDown(open(1), { key: 'e' });
      expect(replies.done).toHaveBeenCalledWith(1);

      open(2).focus();
      fireEvent.keyDown(open(2), { key: 's' });
      expect(replies.snooze).toHaveBeenCalledWith(2, 24);

      open(3).focus();
      fireEvent.keyDown(open(3), { key: 'x' });
      expect(replies.dismiss).toHaveBeenCalledWith(3);

      expect(globalHandler).not.toHaveBeenCalled();
      window.removeEventListener('keydown', globalHandler);
    });

    it('ignores shortcuts with modifier keys', async () => {
      const replies = installReplies([makeResult([makeReply({ emailId: 1 })])]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      const open = within(getRow(1)).getByRole('button', { name: /Subject/ });
      fireEvent.keyDown(open, { key: 'e', metaKey: true });
      fireEvent.keyDown(open, { key: 's', ctrlKey: true });

      expect(replies.done).not.toHaveBeenCalled();
      expect(replies.snooze).not.toHaveBeenCalled();
    });

    it('moves focus between items with j / k', async () => {
      installReplies([makeResult([makeReply({ emailId: 1 }), makeReply({ emailId: 2 })])]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      const open = (id: number) => within(getRow(id)).getByRole('button', { name: /Subject/ });
      open(1).focus();
      fireEvent.keyDown(open(1), { key: 'j' });
      expect(open(2)).toHaveFocus();
      fireEvent.keyDown(open(2), { key: 'k' });
      expect(open(1)).toHaveFocus();
    });

    it('moves focus to the next item after a keyboard action', async () => {
      installReplies([makeResult([makeReply({ emailId: 1 }), makeReply({ emailId: 2 })])]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');

      const open = (id: number) => within(getRow(id)).getByRole('button', { name: /Subject/ });
      open(1).focus();
      fireEvent.keyDown(open(1), { key: 'e' });

      await waitFor(() => expect(open(2)).toHaveFocus());
    });
  });

  describe('empty state', () => {
    it('shows the caught-up state and an Analyze button', async () => {
      installReplies([makeResult([])]);
      render(<NeedsReplyView />);

      expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Analyze recent emails' })).toBeInTheDocument();
    });

    it('backfills every account, reloads, and reports the processed count', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce([
          makeResult([]),
          makeResult([], { accountId: 2, accountEmail: 'work@corp.com' }),
        ])
        .mockResolvedValue([
          makeResult([makeReply({ emailId: 11, subject: 'Found by analysis' })]),
          makeResult([], { accountId: 2, accountEmail: 'work@corp.com' }),
        ]);
      const backfill = vi
        .fn()
        .mockResolvedValueOnce({ processed: 12, skipped: 1 })
        .mockResolvedValueOnce({ processed: 30, skipped: 0 });
      installReplies([], { list, backfill });
      const user = userEvent.setup();
      render(<NeedsReplyView />);

      await user.click(await screen.findByRole('button', { name: 'Analyze recent emails' }));

      expect(backfill).toHaveBeenCalledTimes(2);
      expect(backfill).toHaveBeenCalledWith(1);
      expect(backfill).toHaveBeenCalledWith(2);
      expect(await screen.findByText('Found by analysis')).toBeInTheDocument();
      expect(list).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent('42');
    });

    it('shows the processed count when the backfill finds nothing', async () => {
      installReplies([makeResult([])], {
        backfill: vi.fn().mockResolvedValue({ processed: 5, skipped: 0 }),
      });
      const user = userEvent.setup();
      render(<NeedsReplyView />);

      await user.click(await screen.findByRole('button', { name: 'Analyze recent emails' }));

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('5'));
      expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    });

    it('reports a failed backfill', async () => {
      installReplies([makeResult([])], {
        backfill: vi.fn().mockRejectedValue(new Error('offline')),
      });
      const user = userEvent.setup();
      render(<NeedsReplyView />);

      await user.click(await screen.findByRole('button', { name: 'Analyze recent emails' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/analy/i);
    });
  });

  describe('sent-health banner', () => {
    it('warns when no sent mail was found', async () => {
      installReplies([makeResult([], { sentHealth: 'no-sent-mail' })]);
      render(<NeedsReplyView />);

      expect(
        await screen.findByText(
          /We couldn't find any emails you sent recently, so we can't tell what you've answered\. Check that your Sent folder is syncing\./,
        ),
      ).toBeInTheDocument();
      // An unhealthy account must not be reported as "all caught up"
      expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
    });

    it('does not show the banner when sent mail is healthy', async () => {
      installReplies([makeResult([makeReply({ emailId: 1 })])]);
      render(<NeedsReplyView />);
      await screen.findByText('Subject 1');
      expect(screen.queryByText(/couldn't find any emails you sent/)).not.toBeInTheDocument();
    });
  });
});
