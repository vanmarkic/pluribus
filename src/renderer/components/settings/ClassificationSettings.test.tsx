/**
 * Tests for the privacy surface of ClassificationSettings:
 *  - the provider privacy badge
 *  - the "send short body excerpts to Claude" opt-in (anthropic only)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClassificationSettings } from './ClassificationSettings';

vi.mock('./LlmUsageStats', () => ({ LlmUsageStats: () => null }));
vi.mock('./SemanticIndexPanel', () => ({ SemanticIndexPanel: () => null }));
vi.mock('./CalibrationPanel', () => ({ CalibrationPanel: () => null }));

const BASE = {
  provider: 'anthropic' as const,
  model: 'claude-haiku',
  dailyBudget: 100000,
  dailyEmailLimit: 100,
  autoClassify: false,
};

function install(llm: Record<string, unknown>) {
  const api = (window as any).mailApi;
  const set = vi.fn().mockResolvedValue(undefined);
  api.config = { get: vi.fn().mockResolvedValue(llm), set };
  api.credentials = { hasApiKey: vi.fn().mockResolvedValue(true) };
  api.llm = {
    getEmailBudget: vi.fn().mockResolvedValue({ used: 0, limit: 100 }),
    listModels: vi.fn().mockResolvedValue([
      { id: 'claude-haiku', displayName: 'Claude Haiku' },
      { id: 'mistral:7b', displayName: 'Mistral 7B' },
    ]),
    testConnection: vi.fn().mockResolvedValue({ connected: true }),
  };
  return { set };
}

const EXCERPT_LABEL = 'Send short body excerpts to Claude';

async function renderLoaded() {
  render(<ClassificationSettings />);
  await screen.findByText('Auto-classify new emails');
}

describe('ClassificationSettings privacy', () => {
  describe('privacy badge', () => {
    it('says "Cloud · Claude" for the anthropic provider', async () => {
      install({ ...BASE, provider: 'anthropic' });
      await renderLoaded();

      expect(screen.getByText('Cloud · Claude')).toBeInTheDocument();
      expect(screen.queryByText('Private · on-device')).not.toBeInTheDocument();
    });

    it('says "Private · on-device" for the ollama provider', async () => {
      install({ ...BASE, provider: 'ollama', model: 'mistral:7b' });
      await renderLoaded();

      expect(screen.getByText('Private · on-device')).toBeInTheDocument();
      expect(screen.queryByText('Cloud · Claude')).not.toBeInTheDocument();
    });

    it('follows the provider selector', async () => {
      install({ ...BASE, provider: 'anthropic' });
      const user = userEvent.setup();
      await renderLoaded();

      await user.selectOptions(screen.getByDisplayValue('Anthropic Claude'), 'ollama');

      await waitFor(() => expect(screen.getByText('Private · on-device')).toBeInTheDocument());
    });
  });

  describe('body excerpts toggle', () => {
    it('is shown for anthropic, off by default, with explanatory helper text', async () => {
      install({ ...BASE, provider: 'anthropic' });
      await renderLoaded();

      expect(screen.getByLabelText(EXCERPT_LABEL)).not.toBeChecked();
      expect(
        screen.getByText(/body excerpts are only ever sent to local models unless/i),
      ).toBeInTheDocument();
    });

    it('is hidden for ollama', async () => {
      install({ ...BASE, provider: 'ollama', model: 'mistral:7b' });
      await renderLoaded();

      expect(screen.queryByLabelText(EXCERPT_LABEL)).not.toBeInTheDocument();
      expect(screen.queryByText(EXCERPT_LABEL)).not.toBeInTheDocument();
    });

    it('reflects a stored opt-in', async () => {
      install({ ...BASE, provider: 'anthropic', sendBodyExcerptsToCloud: true });
      await renderLoaded();

      expect(screen.getByLabelText(EXCERPT_LABEL)).toBeChecked();
    });

    it('saves sendBodyExcerptsToCloud through config.set("llm", ...)', async () => {
      const { set } = install({ ...BASE, provider: 'anthropic' });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByLabelText(EXCERPT_LABEL));

      await waitFor(() =>
        expect(set).toHaveBeenCalledWith('llm', {
          ...BASE,
          provider: 'anthropic',
          sendBodyExcerptsToCloud: true,
        }),
      );
      expect(screen.getByLabelText(EXCERPT_LABEL)).toBeChecked();
    });

    it('can be switched back off', async () => {
      const { set } = install({ ...BASE, provider: 'anthropic', sendBodyExcerptsToCloud: true });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByLabelText(EXCERPT_LABEL));

      await waitFor(() =>
        expect(set).toHaveBeenCalledWith(
          'llm',
          expect.objectContaining({ sendBodyExcerptsToCloud: false }),
        ),
      );
    });
  });
});
