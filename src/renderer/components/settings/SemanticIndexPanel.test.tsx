/**
 * Tests for SemanticIndexPanel, including the "System 1 (on-device model)" block.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SemanticIndexPanel } from './SemanticIndexPanel';
import { DEFAULT_SYSTEM1_SETTINGS } from '../../../core/domain';
import type { System1Settings } from '../../../core/domain';
import type { System1Status } from '../../../core/system1/types';
import type { System1ModelImportResult } from '../../../core/model-import';

const MODEL = 'Xenova/multilingual-e5-small';

const STATUS: System1Status = {
  embeddingModel: MODEL,
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
  embeddingModel: MODEL,
  heads: STATUS.heads.map((h) =>
    h.questionId === 'needsReply'
      ? { ...h, armed: true, version: 3, disagreementUpperBound: 0.049, trainSize: 230 }
      : h,
  ),
};

function install(
  opts: {
    settings?: Partial<System1Settings> | null;
    status?: System1Status;
    retrain?: unknown;
    importModel?: unknown;
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
  };
  const embeddings = {
    getStats: vi
      .fn()
      .mockResolvedValue({ totalEmails: 1000, indexed: 250, coverage: 0.25, model: MODEL }),
    backfill: vi.fn().mockResolvedValue({ taskId: 't', total: 0 }),
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
