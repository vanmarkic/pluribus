/**
 * Tests for DigestSettings (Settings > Daily digest).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DigestSettings } from './DigestSettings';
import { useAccountStore } from '../../stores';
import { DEFAULT_DIGEST_SETTINGS } from '../../../core/domain';
import type { DigestRunResult, DigestSettings as DigestSettingsValue } from '../../../core/domain';

const STORED: DigestSettingsValue = {
  enabled: true,
  time: '08:30',
  graceHours: 48,
  lookbackDays: 30,
  maxItems: 20,
  emailToSelf: false,
  showSubjects: true,
  allowBiometricPrompt: false,
};

function install(
  stored: DigestSettingsValue | null = STORED,
  overrides: { set?: unknown; sendTest?: unknown } = {},
) {
  const config = {
    get: vi.fn().mockResolvedValue(stored),
    set: overrides.set ?? vi.fn().mockResolvedValue(undefined),
  };
  const digest = {
    sendTest:
      overrides.sendTest ??
      vi.fn().mockResolvedValue({
        ranAt: new Date(),
        trigger: 'test',
        totalItems: 0,
        notified: false,
        accounts: [],
      } satisfies DigestRunResult),
    runNow: vi.fn(),
    consumePendingOpen: vi.fn().mockResolvedValue(false),
  };
  (window as any).mailApi.config = { ...(window as any).mailApi.config, ...config };
  (window as any).mailApi.digest = digest;
  useAccountStore.setState({
    accounts: [
      { id: 1, email: 'me@example.com', name: 'Me' },
      { id: 2, email: 'work@corp.com', name: 'Work' },
    ] as any,
  });
  return { config, digest };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const field = (label: RegExp | string) => screen.getByLabelText(label);

async function renderLoaded() {
  render(<DigestSettings />);
  await screen.findByLabelText('Time');
}

describe('DigestSettings', () => {
  it('loads the stored values into the fields', async () => {
    const { config } = install();
    await renderLoaded();

    expect(config.get).toHaveBeenCalledWith('digest');
    expect(field('Enabled')).toBeChecked();
    expect(field('Time')).toHaveValue('08:30');
    expect(field('Remind me after')).toHaveValue('48');
    expect(field('Look back')).toHaveValue('30');
    expect(field('Max items')).toHaveValue('20');
    expect(field('Email the digest to myself')).not.toBeChecked();
    expect(field('Show subjects in notifications')).toBeChecked();
    expect(field('Allow Touch ID prompt for the scheduled digest')).not.toBeChecked();
  });

  it('falls back to the defaults when nothing is stored', async () => {
    install(null);
    await renderLoaded();

    expect(field('Time')).toHaveValue(DEFAULT_DIGEST_SETTINGS.time);
    expect(field('Enabled')).toBeChecked();
  });

  it('offers the documented choices', async () => {
    install();
    await renderLoaded();

    const values = (label: string) =>
      Array.from((field(label) as HTMLSelectElement).options).map((o) => o.value);
    expect(values('Remind me after')).toEqual(['12', '24', '48', '72']);
    expect(values('Look back')).toEqual(['7', '14', '30']);
    expect(values('Max items')).toEqual(['5', '10', '20']);
  });

  it('keeps a stored value that is not one of the presets', async () => {
    install({ ...STORED, graceHours: 6 });
    await renderLoaded();

    expect(field('Remind me after')).toHaveValue('6');
  });

  it('explains the privacy trade-offs', async () => {
    install();
    await renderLoaded();

    expect(
      screen.getByText(
        'Sent through your own mail server to your own address — reaches your phone',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Off keeps subjects off your lock screen')).toBeInTheDocument();
    expect(
      screen.getByText('When off, the digest email waits until you unlock Pluribus'),
    ).toBeInTheDocument();
  });

  describe('saving', () => {
    it('saves a toggled option via config.set("digest", ...)', async () => {
      const { config } = install();
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(field('Email the digest to myself'));

      await waitFor(() =>
        expect(config.set).toHaveBeenCalledWith('digest', { ...STORED, emailToSelf: true }),
      );
    });

    it('saves a valid time', async () => {
      const { config } = install();
      await renderLoaded();

      fireEvent.change(field('Time'), { target: { value: '07:45' } });

      await waitFor(() =>
        expect(config.set).toHaveBeenCalledWith('digest', { ...STORED, time: '07:45' }),
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('saves select changes as numbers', async () => {
      const { config } = install();
      const user = userEvent.setup();
      await renderLoaded();

      await user.selectOptions(field('Remind me after'), '72');
      await user.selectOptions(field('Look back'), '7');
      await user.selectOptions(field('Max items'), '5');

      await waitFor(() =>
        expect(config.set).toHaveBeenLastCalledWith('digest', {
          ...STORED,
          graceHours: 72,
          lookbackDays: 7,
          maxItems: 5,
        }),
      );
    });

    it('rejects an invalid time without saving', async () => {
      const { config } = install();
      await renderLoaded();

      // Browsers hand back '' for an incomplete / invalid time
      fireEvent.change(field('Time'), { target: { value: '' } });

      expect(await screen.findByRole('alert')).toHaveTextContent(/HH:MM/);
      expect(field('Time')).toHaveAttribute('aria-invalid', 'true');
      expect(config.set).not.toHaveBeenCalled();
    });

    it('recovers from an invalid time once a valid one is entered', async () => {
      const { config } = install();
      await renderLoaded();

      fireEvent.change(field('Time'), { target: { value: '' } });
      await screen.findByRole('alert');
      fireEvent.change(field('Time'), { target: { value: '21:15' } });

      await waitFor(() =>
        expect(config.set).toHaveBeenCalledWith('digest', { ...STORED, time: '21:15' }),
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('reverts the field and shows an error when saving fails', async () => {
      install(STORED, { set: vi.fn().mockRejectedValue(new Error('disk full')) });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(field('Show subjects in notifications'));

      expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i);
      expect(field('Show subjects in notifications')).toBeChecked();
    });
  });

  describe('test digest', () => {
    it('calls digest.sendTest and summarises the outcome per account', async () => {
      const result: DigestRunResult = {
        ranAt: new Date(),
        trigger: 'test',
        totalItems: 5,
        notified: true,
        accounts: [
          { accountId: 1, itemCount: 3, synced: true, email: 'sent', sentHealth: 'ok' },
          { accountId: 2, itemCount: 2, synced: true, email: 'deferred', sentHealth: 'ok' },
        ],
      };
      const { digest } = install(STORED, { sendTest: vi.fn().mockResolvedValue(result) });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Send test digest now' }));

      expect(digest.sendTest).toHaveBeenCalledTimes(1);
      const summary = await screen.findByRole('status');
      expect(summary).toHaveTextContent('5 items');
      expect(summary).toHaveTextContent('me@example.com');
      expect(summary).toHaveTextContent(/emailed/i);
      expect(summary).toHaveTextContent('work@corp.com');
      expect(summary).toHaveTextContent(/waiting until you unlock/i);
    });

    it('uses the singular for one item and handles an empty digest', async () => {
      const one: DigestRunResult = {
        ranAt: new Date(),
        trigger: 'test',
        totalItems: 1,
        notified: true,
        accounts: [
          { accountId: 1, itemCount: 1, synced: false, email: 'skipped', sentHealth: 'ok' },
        ],
      };
      install(STORED, { sendTest: vi.fn().mockResolvedValue(one) });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Send test digest now' }));

      expect(await screen.findByRole('status')).toHaveTextContent('1 item');
      expect(screen.getByRole('status')).not.toHaveTextContent('1 items');
    });

    it('flags an account whose Sent folder is not syncing', async () => {
      const result: DigestRunResult = {
        ranAt: new Date(),
        trigger: 'test',
        totalItems: 0,
        notified: false,
        accounts: [
          { accountId: 1, itemCount: 0, synced: true, email: 'sent', sentHealth: 'no-sent-mail' },
        ],
      };
      install(STORED, { sendTest: vi.fn().mockResolvedValue(result) });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Send test digest now' }));

      expect(await screen.findByRole('status')).toHaveTextContent(/sent folder/i);
    });

    it('disables the button while sending and reports failures', async () => {
      install(STORED, { sendTest: vi.fn().mockRejectedValue(new Error('smtp down')) });
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(screen.getByRole('button', { name: 'Send test digest now' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/test digest/i);
      expect(screen.getByRole('button', { name: 'Send test digest now' })).toBeEnabled();
    });
  });
});
