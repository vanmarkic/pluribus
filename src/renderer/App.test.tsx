/**
 * Tests for App-level navigation from the daily digest:
 *  - the main process pushes 'digest:open' (notification / email click)
 *  - or the click happened before the renderer was ready, so the flag is
 *    pending and consumed once on mount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { App } from './App';
import {
  store,
  useUIStore,
  useEmailUiStore,
  useAccountStore,
  useLicenseStore,
  useOllamaSetupStore,
} from './stores';
import { useRepliesStore } from './stores/repliesStore';

// Everything visual is irrelevant here; keep the shell, drop the children.
vi.mock('./layouts/MainLayout', () => ({ MainLayout: () => <div data-testid="main-layout" /> }));
vi.mock('./layouts/TitleBar', () => ({ TitleBar: () => null }));
vi.mock('./components/DemoBanner', () => ({ DemoBanner: () => null }));
vi.mock('./components/OllamaSetupBanner', () => ({ OllamaSetupBanner: () => null }));
vi.mock('./components/AccountWizard', () => ({ AccountWizard: () => null }));
vi.mock('./components/ComposeModal', () => ({ ComposeModal: () => null }));
vi.mock('./components/LicenseActivation', () => ({ LicenseActivationModal: () => null }));

type Listener = (...args: unknown[]) => void;

function installApi(pending: boolean | Promise<boolean>) {
  const listeners = new Map<string, Set<Listener>>();
  const api = (window as any).mailApi;
  api.on = vi.fn((channel: string, cb: Listener) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(cb);
  });
  api.off = vi.fn((channel: string, cb: Listener) => listeners.get(channel)?.delete(cb));
  api.digest = { consumePendingOpen: vi.fn().mockReturnValue(Promise.resolve(pending)) };
  api.replies = { list: vi.fn().mockResolvedValue([]) };
  const emit = (channel: string, ...args: unknown[]) =>
    listeners.get(channel)?.forEach((cb) => cb(...args));
  return { api, emit, listeners };
}

function renderApp() {
  return render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
}

beforeEach(() => {
  useUIStore.setState({ view: 'inbox' });
  useEmailUiStore.setState({ selectedId: 42, filter: { folderPath: 'INBOX' } });
  useRepliesStore.setState({ results: [], loaded: false, loading: false, error: null });
  // Neutralise unrelated startup work done by App on mount
  useAccountStore.setState({ loadAccounts: vi.fn().mockResolvedValue(undefined) });
  useLicenseStore.setState({ loadState: vi.fn().mockResolvedValue(undefined) });
  useOllamaSetupStore.setState({ checkAndStart: vi.fn().mockResolvedValue(undefined) });
});

describe('App digest navigation', () => {
  it("navigates to 'needs-reply' when the digest:open event arrives", async () => {
    const { emit } = installApi(false);
    renderApp();
    await waitFor(() =>
      expect((window as any).mailApi.digest.consumePendingOpen).toHaveBeenCalled(),
    );
    expect(useUIStore.getState().view).toBe('inbox');

    act(() => emit('digest:open'));

    expect(useUIStore.getState().view).toBe('needs-reply');
  });

  it('clears the open email so the reader does not show an unrelated message', async () => {
    const { emit } = installApi(false);
    renderApp();

    act(() => emit('digest:open'));

    expect(useEmailUiStore.getState().selectedId).toBeNull();
  });

  it('navigates on mount when consumePendingOpen resolves true', async () => {
    installApi(true);
    renderApp();

    await waitFor(() => expect(useUIStore.getState().view).toBe('needs-reply'));
    expect((window as any).mailApi.digest.consumePendingOpen).toHaveBeenCalledTimes(1);
  });

  it('stays put when nothing is pending', async () => {
    installApi(false);
    renderApp();

    await waitFor(() =>
      expect((window as any).mailApi.digest.consumePendingOpen).toHaveBeenCalled(),
    );
    await act(async () => {});
    expect(useUIStore.getState().view).toBe('inbox');
  });

  it('survives consumePendingOpen rejecting', async () => {
    const { api } = installApi(false);
    api.digest.consumePendingOpen = vi.fn().mockRejectedValue(new Error('ipc down'));
    renderApp();

    await act(async () => {});
    expect(useUIStore.getState().view).toBe('inbox');
  });

  it('refreshes the replies list when the digest is opened', async () => {
    const { api, emit } = installApi(false);
    renderApp();
    await waitFor(() => expect(api.digest.consumePendingOpen).toHaveBeenCalled());

    act(() => emit('digest:open'));

    await waitFor(() => expect(api.replies.list).toHaveBeenCalled());
  });

  it('stops listening on unmount', async () => {
    const { api, listeners } = installApi(false);
    const { unmount } = renderApp();
    await waitFor(() => expect(api.digest.consumePendingOpen).toHaveBeenCalled());
    expect(listeners.get('digest:open')?.size).toBe(1);

    unmount();

    expect(listeners.get('digest:open')?.size ?? 0).toBe(0);
  });
});
