/**
 * Tests for SemanticIndexPanel, including the "System 1 (on-device model)" block.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SemanticIndexPanel } from './SemanticIndexPanel';
import { DEFAULT_SYSTEM1_SETTINGS } from '../../../core/domain';
import type { System1Settings } from '../../../core/domain';
import type { System1Status } from '../../../core/system1/types';
import type { System1ModelImportResult } from '../../../core/model-import';

const MODEL = 'Xenova/multilingual-e5-small';

const STATUS: System1Status = {
  embeddingModel: MODEL,
  modelInstalled: true,
  modelDownloading: false,
  modelError: null,
  heads: [
    {
      questionId: 'folder',
      armed: true,
      version: 4,
      coverage: 0.62,
      agreement: 0.94,
      disagreementUpperBound: 0.047,
      trainSize: 412,
      trainedAt: new Date('2026-06-01T03:10:00Z'),
    },
    {
      questionId: 'needsReply',
      armed: false,
      version: 2,
      coverage: 0.31,
      agreement: 0.88,
      disagreementUpperBound: 0.113,
      trainSize: 188,
      trainedAt: new Date('2026-06-01T03:10:00Z'),
    },
    {
      questionId: 'importance',
      armed: false,
      version: null,
      coverage: null,
      agreement: null,
      disagreementUpperBound: null,
      trainSize: 41,
      trainedAt: null,
    },
  ],
};

const RETRAINED: System1Status = {
  ...STATUS,
  heads: STATUS.heads.map((h) =>
    h.questionId === 'needsReply'
      ? { ...h, armed: true, version: 3, disagreementUpperBound: 0.049, trainSize: 230 }
      : h,
  ),
};

const NOT_INSTALLED: System1Status = {
  ...STATUS,
  modelInstalled: false,
  heads: STATUS.heads.map((h) => ({
    ...h,
    armed: false,
    version: null,
    coverage: null,
    agreement: null,
    disagreementUpperBound: null,
    trainSize: 0,
    trainedAt: null,
  })),
};
const DOWNLOADING: System1Status = { ...NOT_INSTALLED, modelDownloading: true };

function install(
  opts: {
    settings?: Partial<System1Settings> | null;
    status?: System1Status;
    retrain?: unknown;
    importModel?: unknown;
    downloadModel?: unknown;
    backfill?: unknown;
    set?: unknown;
  } = {},
) {
  const api = (window as any).mailApi;
  const config = {
    get: vi.fn(async (key: string) =>
      key === 'system1'
        ? opts.settings === undefined
          ? { ...DEFAULT_SYSTEM1_SETTINGS }
          : opts.settings
        : null,
    ),
    set: opts.set ?? vi.fn().mockResolvedValue(undefined),
  };
  const system1 = {
    getStatus: vi.fn().mockResolvedValue(opts.status ?? STATUS),
    retrain: opts.retrain ?? vi.fn().mockResolvedValue(RETRAINED),
    importModel:
      opts.importModel ??
      vi.fn().mockResolvedValue({ status: 'cancelled' } satisfies System1ModelImportResult),
    downloadModel: opts.downloadModel ?? vi.fn().mockResolvedValue(STATUS),
  };
  const embeddings = {
    getStats: vi
      .fn()
      .mockResolvedValue({ totalEmails: 1000, indexed: 250, coverage: 0.25, model: MODEL }),
    backfill:
      opts.backfill ?? vi.fn().mockResolvedValue({ taskId: 't', total: 0, status: 'started' }),
  };
  api.config = { ...api.config, ...config };
  api.system1 = system1;
  api.embeddings = embeddings;
  return { config, system1, embeddings };
}

async function renderLoaded() {
  render(<SemanticIndexPanel />);
  await screen.findByText('System 1 (on-device model)');
  await screen.findByRole('table', { name: /System 1 questions/i });
}

const row = (name: RegExp | string) => screen.getByRole('row', { name });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SemanticIndexPanel - semantic index (unchanged)', () => {
  it('still shows index coverage and the rebuild button', async () => {
    const { embeddings } = install();
    await renderLoaded();

    expect(await screen.findByText(/250 \/ 1,000 emails/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rebuild index' }));
    expect(embeddings.backfill).toHaveBeenCalledWith({ limit: 5000 });
  });
});

describe('SemanticIndexPanel - System 1 block', () => {
  it('explains that everything runs on this device and shows the model id', async () => {
    install();
    await renderLoaded();

    expect(screen.getByText(/Runs entirely on this device/)).toBeInTheDocument();
    expect(screen.getByTestId('system1-model')).toHaveTextContent(MODEL);
  });

  it('says that a changed model only takes effect after a restart', async () => {
    install();
    await renderLoaded();

    expect(screen.getByText(/restart the app/)).toBeInTheDocument();
  });

  it('shows one status row per question: armed / shadow, coverage, agreement, bound, size, date', async () => {
    install();
    await renderLoaded();

    const folder = within(row(/Folder/));
    expect(folder.getByText('Armed')).toBeInTheDocument();
    expect(folder.getByText('62%')).toBeInTheDocument(); // coverage
    expect(folder.getByText('94%')).toBeInTheDocument(); // agreement with the LLM
    expect(folder.getByText('≤ 4.7%')).toBeInTheDocument(); // 95% bound on disagreement
    expect(folder.getByText('412')).toBeInTheDocument(); // train size
    expect(folder.getByText(/2026/)).toBeInTheDocument(); // trained at

    const needsReply = within(row(/Needs reply/));
    expect(needsReply.getByText('Shadow')).toBeInTheDocument();
    expect(needsReply.getByText('31%')).toBeInTheDocument();
    expect(needsReply.getByText('88%')).toBeInTheDocument();
    expect(needsReply.getByText('≤ 11.3%')).toBeInTheDocument();
    expect(needsReply.getByText('188')).toBeInTheDocument();

    const importance = within(row(/Importance/));
    expect(importance.getByText('Shadow')).toBeInTheDocument();
    expect(importance.getByText('Not trained yet')).toBeInTheDocument();
    expect(importance.getByText('41')).toBeInTheDocument();
  });

  it('explains armed and shadow in plain words', async () => {
    install();
    await renderLoaded();
    expect(screen.getByText(/Armed answers on its own/i)).toBeInTheDocument();
    expect(screen.getByText(/Shadow keeps learning/i)).toBeInTheDocument();
  });

  it('reflects the stored enabled flag', async () => {
    install({ settings: { enabled: false } });
    await renderLoaded();
    expect(screen.getByRole('checkbox', { name: /On-device model/i })).not.toBeChecked();
  });

  it('falls back to the defaults when nothing is stored', async () => {
    install({ settings: null });
    await renderLoaded();
    expect(screen.getByRole('checkbox', { name: /On-device model/i })).toBeChecked();
  });

  it('the toggle saves the system1 config', async () => {
    const { config } = install();
    const user = userEvent.setup();
    await renderLoaded();

    const toggle = screen.getByRole('checkbox', { name: /On-device model/i });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(config.set).toHaveBeenCalledWith('system1', { enabled: false });
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('puts the toggle back and says so when saving fails', async () => {
    install({ set: vi.fn().mockRejectedValue(new Error('disk full')) });
    const user = userEvent.setup();
    await renderLoaded();

    const toggle = screen.getByRole('checkbox', { name: /On-device model/i });
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't save/i);
  });

  it('Retrain now calls the API and shows the new statuses', async () => {
    const { system1 } = install();
    const user = userEvent.setup();
    await renderLoaded();

    expect(within(row(/Needs reply/)).getByText('Shadow')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retrain now' }));

    expect(system1.retrain).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(row(/Needs reply/)).getByText('Armed')).toBeInTheDocument());
    expect(within(row(/Needs reply/)).getByText('230')).toBeInTheDocument();
  });

  it('disables Retrain now while training and reports a failure', async () => {
    let rejectTraining: (e: Error) => void = () => {};
    const retrain = vi.fn(
      () =>
        new Promise<System1Status>((_, reject) => {
          rejectTraining = reject;
        }),
    );
    install({ retrain });
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: 'Retrain now' }));
    expect(screen.getByRole('button', { name: 'Training…' })).toBeDisabled();

    rejectTraining(new Error('encoder not ready'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/encoder not ready/);
    expect(screen.getByRole('button', { name: 'Retrain now' })).toBeEnabled();
  });

  it('Import model from folder calls the API and confirms the install', async () => {
    const importModel = vi.fn().mockResolvedValue({
      status: 'imported',
      model: MODEL,
      files: 6,
      bytes: 118_000_000,
    } satisfies System1ModelImportResult);
    install({ importModel });
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: /Import model from folder/ }));

    expect(importModel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Installed Xenova\/multilingual-e5-small/)).toBeInTheDocument();
    expect(screen.getByText(/113 MB/)).toBeInTheDocument();
  });

  it('says nothing when the folder picker is cancelled', async () => {
    const { system1 } = install();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: /Import model from folder/ }));

    await waitFor(() => expect(system1.importModel).toHaveBeenCalled());
    expect(screen.queryByText(/Installed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows why an import was refused', async () => {
    install({
      importModel: vi.fn().mockRejectedValue(new Error('Missing: tokenizer.json')),
    });
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: /Import model from folder/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Missing: tokenizer\.json/);
  });

  it('degrades gracefully when the status cannot be loaded', async () => {
    const { system1 } = install();
    system1.getStatus.mockRejectedValue(new Error('boom'));
    render(<SemanticIndexPanel />);
    await screen.findByText('System 1 (on-device model)');
    expect(await screen.findByText(/Couldn't load the System 1 status/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retrain now' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The model is only downloaded on the user's click
// ---------------------------------------------------------------------------

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SemanticIndexPanel - on-device model', () => {
  describe('not installed', () => {
    it('explains in plain words what a download means for privacy', async () => {
      install({ status: NOT_INSTALLED });
      await renderLoaded();

      const notice = screen.getByTestId('system1-model-state');
      expect(notice).toHaveTextContent(/on-device model \(about 118 MB\) is not installed/i);
      expect(notice).toHaveTextContent(/connects to huggingface\.co/i);
      expect(notice).toHaveTextContent(/your IP address is visible to that site/i);
      expect(notice).toHaveTextContent(/no mail or mail data is sent/i);
      expect(notice).toHaveTextContent(/System 1 is off/i);
      expect(screen.getByRole('button', { name: 'Download model' })).toBeEnabled();
      expect(screen.queryByText('Model installed')).not.toBeInTheDocument();
    });

    it('never downloads by itself: not on render, not while the status is loaded', async () => {
      const { system1 } = install({ status: NOT_INSTALLED });
      await renderLoaded();
      expect(system1.downloadModel).not.toHaveBeenCalled();
    });

    it('keeps the offline way: Import model from folder', async () => {
      install({ status: NOT_INSTALLED });
      await renderLoaded();
      expect(screen.getByRole('button', { name: /Import model from folder/ })).toBeEnabled();
    });

    it('the Download model button starts the download, shows progress, then the installed state', async () => {
      const download = deferred<System1Status>();
      const { system1 } = install({
        status: NOT_INSTALLED,
        downloadModel: vi.fn(() => download.promise),
      });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Download model' }));

      expect(system1.downloadModel).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Downloading…' })).toBeDisabled();
      expect(screen.getByTestId('system1-model-state')).toHaveTextContent(/downloading/i);

      download.resolve(STATUS);

      expect(await screen.findByText('Model installed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Download model|Downloading/ })).toBeNull();
      expect(screen.queryByText(/huggingface\.co/)).not.toBeInTheDocument();
      // The trained heads come back with the fresh status.
      expect(within(row(/Folder/)).getByText('Armed')).toBeInTheDocument();
    });

    it('a second click while it runs does nothing', async () => {
      const download = deferred<System1Status>();
      const { system1 } = install({
        status: NOT_INSTALLED,
        downloadModel: vi.fn(() => download.promise),
      });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Download model' }));
      await user.click(screen.getByRole('button', { name: 'Downloading…' }));

      expect(system1.downloadModel).toHaveBeenCalledTimes(1);
      download.resolve(STATUS);
      await screen.findByText('Model installed');
    });

    it('shows why a download failed and offers a retry that works', async () => {
      const downloadModel = vi
        .fn()
        .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND huggingface.co'))
        .mockResolvedValueOnce(STATUS);
      install({ status: NOT_INSTALLED, downloadModel });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Download model' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/ENOTFOUND huggingface\.co/);
      expect(screen.getByRole('button', { name: 'Retry download' })).toBeEnabled();

      await user.click(screen.getByRole('button', { name: 'Retry download' }));

      expect(downloadModel).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('Model installed')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the failure the main process reports in the status (e.g. after reopening Settings)', async () => {
      const { system1 } = install({
        status: {
          ...NOT_INSTALLED,
          modelError: 'The model was downloaded but could not be saved.',
        },
      });
      const user = userEvent.setup();
      await renderLoaded();

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/);
      await user.click(screen.getByRole('button', { name: 'Retry download' }));
      expect(system1.downloadModel).toHaveBeenCalledTimes(1);
    });

    it('after an import the panel shows the installed state', async () => {
      const { system1 } = install({
        status: NOT_INSTALLED,
        importModel: vi.fn().mockResolvedValue({
          status: 'imported',
          model: MODEL,
          files: 6,
          bytes: 118_000_000,
        } satisfies System1ModelImportResult),
      });
      const user = userEvent.setup();
      await renderLoaded();
      system1.getStatus.mockResolvedValue(STATUS);

      await user.click(screen.getByRole('button', { name: /Import model from folder/ }));

      expect(await screen.findByText('Model installed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download model' })).toBeNull();
    });

    it('a cancelled import leaves the "not installed" notice alone', async () => {
      install({ status: NOT_INSTALLED });
      const user = userEvent.setup();
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: /Import model from folder/ }));
      expect(screen.getByRole('button', { name: 'Download model' })).toBeInTheDocument();
    });
  });

  describe('polling while a download runs', () => {
    beforeEach(() => {
      // Only the timers the panel polls with: userEvent and Testing Library keep real ones.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks for the status about once a second until the model is installed, then stops', async () => {
      const { system1 } = install({ status: DOWNLOADING });
      await renderLoaded();
      expect(screen.getByRole('button', { name: 'Downloading…' })).toBeDisabled();
      const callsAtStart = system1.getStatus.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(system1.getStatus.mock.calls.length).toBe(callsAtStart + 3);
      expect(screen.getByRole('button', { name: 'Downloading…' })).toBeDisabled();

      system1.getStatus.mockResolvedValue(STATUS);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(await screen.findByText('Model installed')).toBeInTheDocument();

      const callsWhenDone = system1.getStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(system1.getStatus.mock.calls.length).toBe(callsWhenDone);
    });

    it('polls during a download started here, and shows a failure the poll reports', async () => {
      const download = deferred<System1Status>();
      const { system1 } = install({
        status: NOT_INSTALLED,
        downloadModel: vi.fn(() => download.promise),
      });
      await renderLoaded();
      fireEvent.click(screen.getByRole('button', { name: 'Download model' }));
      system1.getStatus.mockResolvedValue(DOWNLOADING);
      const before = system1.getStatus.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(system1.getStatus.mock.calls.length).toBeGreaterThanOrEqual(before + 2);

      // The download fails: the invoke rejects and the status keeps the reason.
      system1.getStatus.mockResolvedValue({ ...NOT_INSTALLED, modelError: 'network down' });
      await act(async () => {
        download.reject(new Error('network down'));
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(/network down/);
      expect(screen.getByRole('button', { name: 'Retry download' })).toBeEnabled();
    });

    it('does not poll when nothing is downloading', async () => {
      const { system1 } = install({ status: NOT_INSTALLED });
      await renderLoaded();
      const calls = system1.getStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(system1.getStatus.mock.calls.length).toBe(calls);
    });
  });

  describe('installed', () => {
    it('shows a small "Model installed" line and no download button', async () => {
      install({ status: STATUS });
      await renderLoaded();
      expect(screen.getByText('Model installed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Download model/ })).toBeNull();
      expect(screen.queryByText(/huggingface\.co/)).not.toBeInTheDocument();
    });
  });

  describe('Rebuild index needs the model', () => {
    it('is disabled and says why while the model is not installed', async () => {
      const { embeddings } = install({ status: NOT_INSTALLED });
      await renderLoaded();

      const rebuild = await screen.findByRole('button', { name: 'Rebuild index' });
      expect(rebuild).toBeDisabled();
      expect(screen.getByTestId('rebuild-needs-model')).toHaveTextContent(
        /needs the on-device model first/i,
      );
      expect(screen.getByTestId('rebuild-needs-model')).toHaveTextContent(/download/i);
      fireEvent.click(rebuild);
      expect(embeddings.backfill).not.toHaveBeenCalled();
    });

    it('is disabled while the model is still downloading', async () => {
      install({ status: DOWNLOADING });
      await renderLoaded();
      expect(await screen.findByRole('button', { name: 'Rebuild index' })).toBeDisabled();
    });

    it('works again once the model is installed', async () => {
      const { embeddings } = install({ status: NOT_INSTALLED });
      const user = userEvent.setup();
      await renderLoaded();
      expect(await screen.findByRole('button', { name: 'Rebuild index' })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'Download model' }));

      await screen.findByText('Model installed');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Rebuild index' })).toBeEnabled(),
      );
      expect(screen.queryByTestId('rebuild-needs-model')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Rebuild index' }));
      expect(embeddings.backfill).toHaveBeenCalledWith({ limit: 5000 });
    });

    it('also explains it when the main process refuses (a stale panel)', async () => {
      install({
        status: STATUS,
        backfill: vi
          .fn()
          .mockResolvedValue({ taskId: '', total: 0, status: 'model-not-installed' }),
      });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(await screen.findByRole('button', { name: 'Rebuild index' }));

      expect(await screen.findByText(/needs the on-device model first/i)).toBeInTheDocument();
      expect(screen.queryByText(/Indexing 0 emails/)).not.toBeInTheDocument();
    });
  });
});
