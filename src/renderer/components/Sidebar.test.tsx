/**
 * Tests for the Sidebar "Needs your reply" entry and its count badge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { Sidebar } from './Sidebar';
import { store, useUIStore, useEmailUiStore, useAccountStore } from '../stores';
import { useRepliesStore } from '../stores/repliesStore';
import type { ForgottenReply, ForgottenRepliesResult } from '../../core/domain';

vi.mock('./AccountSwitcher', () => ({ AccountSwitcher: () => null }));
vi.mock('./LicenseActivation', () => ({ LicenseStatusBadge: () => null }));

function makeReply(emailId: number): ForgottenReply {
  return {
    emailId,
    accountId: 1,
    from: { address: 'a@example.com', name: 'A' },
    subject: `S${emailId}`,
    date: new Date(),
    ageHours: 30,
    folderPath: 'INBOX',
    needsReply: 0.9,
    importance: 3,
    score: 1,
    basis: 'signal',
    signalSource: 'system2',
    reason: 'r',
  };
}

function install(results: ForgottenRepliesResult[]) {
  const api = (window as any).mailApi;
  api.replies = { list: vi.fn().mockResolvedValue(results) };
  api.drafts = { list: vi.fn().mockResolvedValue([]) };
  api.awaiting = { list: vi.fn().mockResolvedValue([]) };
  return api;
}

const result = (ids: number[], accountId = 1): ForgottenRepliesResult => ({
  accountId,
  accountEmail: `a${accountId}@example.com`,
  items: ids.map(makeReply),
  sentHealth: 'ok',
  generatedAt: new Date(),
});

const renderSidebar = () =>
  render(
    <Provider store={store}>
      <Sidebar />
    </Provider>,
  );

beforeEach(() => {
  useUIStore.setState({ view: 'inbox' });
  useEmailUiStore.setState({ selectedId: 5, filter: {} });
  useAccountStore.setState({ selectedAccountId: 1, accounts: [] });
  useRepliesStore.setState({
    results: [],
    loaded: false,
    loading: false,
    error: null,
    actionError: null,
  });
});

describe('Sidebar: Needs your reply', () => {
  it('shows the entry with the total count across accounts', async () => {
    install([result([1, 2]), result([3], 2)]);
    renderSidebar();

    const entry = await screen.findByRole('button', { name: /Needs your reply/ });
    await waitFor(() => expect(within(entry).getByText('3')).toBeInTheDocument());
  });

  it('shows no count badge when nothing is waiting', async () => {
    const api = install([result([])]);
    renderSidebar();
    await waitFor(() => expect(api.replies.list).toHaveBeenCalled());

    const entry = screen.getByRole('button', { name: /Needs your reply/ });
    expect(entry.querySelector('.sidebar-item-count')).toBeNull();
  });

  it('keeps "Awaiting Reply" (mail I sent) separate', async () => {
    install([result([1])]);
    renderSidebar();

    expect(await screen.findByRole('button', { name: /Needs your reply/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Awaiting Reply/ })).toBeInTheDocument();
  });

  it('navigates to the needs-reply view and clears the open email', async () => {
    install([result([1])]);
    const user = userEvent.setup();
    renderSidebar();

    await user.click(await screen.findByRole('button', { name: /Needs your reply/ }));

    expect(useUIStore.getState().view).toBe('needs-reply');
    expect(useEmailUiStore.getState().selectedId).toBeNull();
  });

  it('marks the entry active on the needs-reply view', async () => {
    install([result([1])]);
    useUIStore.setState({ view: 'needs-reply' });
    renderSidebar();

    expect(await screen.findByRole('button', { name: /Needs your reply/ })).toHaveClass('active');
  });

  it('follows optimistic removals from the view', async () => {
    install([result([1, 2])]);
    renderSidebar();
    const entry = await screen.findByRole('button', { name: /Needs your reply/ });
    await waitFor(() => expect(within(entry).getByText('2')).toBeInTheDocument());

    (window as any).mailApi.replies.done = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await useRepliesStore.getState().done(1);
    });

    await waitFor(() => expect(within(entry).getByText('1')).toBeInTheDocument());
  });
});
