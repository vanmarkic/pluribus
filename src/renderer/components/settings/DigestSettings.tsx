import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { useAccountStore } from '../../stores';
import { DEFAULT_DIGEST_SETTINGS } from '../../../core/domain';
import type {
  DigestAccountOutcome,
  DigestMinImportance,
  DigestRunResult,
  DigestSettings as DigestSettingsValue,
} from '../../../core/domain';

/**
 * Daily digest settings: a once-a-day reminder of important emails the user
 * hasn't answered. Every change is saved straight away (like the AI
 * classification settings); `config.set('digest', ...)` validates on the
 * main-process side as well.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const GRACE_HOURS = [12, 24, 48, 72, 96];
const LOOKBACK_DAYS = [7, 14, 30];
const MAX_ITEMS = [5, 10, 20];

const MIN_IMPORTANCE_OPTIONS: { value: DigestMinImportance; label: string }[] = [
  { value: 2, label: 'Normal and above' },
  { value: 3, label: 'Important and above' },
  { value: 4, label: 'Critical only' },
];

/**
 * "Start at login" only exists on macOS and Windows (Electron has no login-item
 * API on Linux), so the toggle is hidden there.
 */
const supportsLoginItem = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|Win/i.test(navigator.platform || navigator.userAgent);

/** The presets, plus the stored value when it isn't one of them (e.g. set elsewhere). */
const withCurrent = (presets: number[], current: number): number[] =>
  presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);

const formatHours = (hours: number): string =>
  hours >= 24 && hours % 24 === 0
    ? `${hours / 24} day${hours === 24 ? '' : 's'}`
    : `${hours} hours`;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const EMAIL_OUTCOME: Record<DigestAccountOutcome['email'], string> = {
  sent: 'emailed to you',
  deferred: 'email waiting until you unlock Pluribus',
  skipped: 'email not sent',
  failed: 'email failed to send',
};

type RowProps = {
  id: string;
  label: string;
  helper?: string;
  children: React.ReactNode;
};

function Row({ id, label, helper, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {label}
        </label>
        {helper && (
          <div
            id={`${id}-help`}
            className="text-sm"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {helper}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function DigestSettings() {
  const accounts = useAccountStore((s) => s.accounts);

  const [settings, setSettings] = useState<DigestSettingsValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The time field keeps its own draft so an invalid entry is never saved.
  const [timeDraft, setTimeDraft] = useState('');
  const [timeInvalid, setTimeInvalid] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DigestRunResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const stored = (await window.mailApi.config.get(
          'digest',
        )) as Partial<DigestSettingsValue> | null;
        const merged = { ...DEFAULT_DIGEST_SETTINGS, ...(stored ?? {}) };
        setSettings(merged);
        setTimeDraft(merged.time);
      } catch (error) {
        console.error('Failed to load digest settings:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const save = async (patch: Partial<DigestSettingsValue>) => {
    if (!settings) return;
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaveError(null);
    try {
      await window.mailApi.config.set('digest', next);
    } catch (error) {
      console.error('Failed to save digest settings:', error);
      setSettings(previous);
      setTimeDraft(previous.time);
      setSaveError("Couldn't save the digest settings. Your previous settings are still in place.");
    }
  };

  const handleTimeChange = (value: string) => {
    setTimeDraft(value);
    if (!TIME_PATTERN.test(value)) {
      setTimeInvalid(true);
      return;
    }
    setTimeInvalid(false);
    if (settings && value !== settings.time) save({ time: value });
  };

  const handleTimeBlur = () => {
    if (!timeInvalid || !settings) return;
    // Leave the field showing what is actually saved.
    setTimeDraft(settings.time);
    setTimeInvalid(false);
  };

  const handleSendTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      setTestResult(await window.mailApi.digest.sendTest());
    } catch (error) {
      console.error('Failed to send test digest:', error);
      setTestError("Couldn't send the test digest. Please try again.");
    } finally {
      setTesting(false);
    }
  };

  const accountLabel = (accountId: number): string =>
    accounts.find((a) => a.id === accountId)?.email ?? `Account ${accountId}`;

  if (loading) {
    return (
      <div className="text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-danger)' }}>
        Couldn't load the digest settings.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Row
        id="digest-enabled"
        label="Enabled"
        helper="A daily reminder of emails you haven't answered"
      >
        <input
          id="digest-enabled"
          type="checkbox"
          checked={settings.enabled}
          aria-describedby="digest-enabled-help"
          onChange={(e) => save({ enabled: e.target.checked })}
          className="h-5 w-5 shrink-0"
        />
      </Row>

      <div>
        <Row id="digest-time" label="Time" helper="When the digest is sent, in your local time">
          <input
            id="digest-time"
            type="time"
            value={timeDraft}
            aria-invalid={timeInvalid}
            aria-describedby={timeInvalid ? 'digest-time-error' : 'digest-time-help'}
            onChange={(e) => handleTimeChange(e.target.value)}
            onBlur={handleTimeBlur}
            className="input shrink-0"
            style={{ width: '8rem' }}
          />
        </Row>
        {timeInvalid && (
          <div
            id="digest-time-error"
            role="alert"
            className="mt-1 text-sm"
            style={{ color: 'var(--color-danger)' }}
          >
            Enter a time as HH:MM (24-hour), for example 09:00.
          </div>
        )}
      </div>

      <Row
        id="digest-grace"
        label="Remind me after"
        helper="How long an email can wait before it counts as forgotten"
      >
        <select
          id="digest-grace"
          value={settings.graceHours}
          aria-describedby="digest-grace-help"
          onChange={(e) => save({ graceHours: parseInt(e.target.value, 10) })}
          className="input shrink-0"
          style={{ width: '10rem' }}
        >
          {withCurrent(GRACE_HOURS, settings.graceHours).map((hours) => (
            <option key={hours} value={hours}>
              {formatHours(hours)}
            </option>
          ))}
        </select>
      </Row>

      <Row
        id="digest-importance"
        label="Include"
        helper="Emails the model rates below this are never listed"
      >
        <select
          id="digest-importance"
          value={settings.minImportance}
          aria-describedby="digest-importance-help"
          onChange={(e) =>
            save({ minImportance: parseInt(e.target.value, 10) as DigestMinImportance })
          }
          className="input shrink-0"
          style={{ width: '10rem' }}
        >
          {MIN_IMPORTANCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Row>

      <div>
        <Row
          id="digest-lookback"
          label="Look back"
          helper="How far back to look for unanswered emails"
        >
          <select
            id="digest-lookback"
            value={settings.lookbackDays}
            aria-describedby="digest-lookback-help"
            onChange={(e) => save({ lookbackDays: parseInt(e.target.value, 10) })}
            className="input shrink-0"
            style={{ width: '10rem' }}
          >
            {withCurrent(LOOKBACK_DAYS, settings.lookbackDays).map((days) => (
              <option key={days} value={days}>
                {plural(days, 'day', 'days')}
              </option>
            ))}
          </select>
        </Row>
        {settings.graceHours >= settings.lookbackDays * 24 && (
          <div
            role="status"
            className="mt-1 text-sm"
            style={{ color: 'var(--color-warning-text, var(--color-danger))' }}
          >
            Emails older than the look-back are ignored, so nothing can be listed with these two
            values. Choose a longer look-back or a shorter wait.
          </div>
        )}
      </div>

      <Row id="digest-max" label="Max items" helper="The most emails listed in one digest">
        <select
          id="digest-max"
          value={settings.maxItems}
          aria-describedby="digest-max-help"
          onChange={(e) => save({ maxItems: parseInt(e.target.value, 10) })}
          className="input shrink-0"
          style={{ width: '10rem' }}
        >
          {withCurrent(MAX_ITEMS, settings.maxItems).map((count) => (
            <option key={count} value={count}>
              {plural(count, 'item', 'items')}
            </option>
          ))}
        </select>
      </Row>

      <div className="pt-4 border-t space-y-4" style={{ borderColor: 'var(--color-border)' }}>
        <Row
          id="digest-email"
          label="Email the digest to myself"
          helper="Sent through your own mail server to your own address — reaches your phone"
        >
          <input
            id="digest-email"
            type="checkbox"
            checked={settings.emailToSelf}
            aria-describedby="digest-email-help"
            onChange={(e) => save({ emailToSelf: e.target.checked })}
            className="h-5 w-5 shrink-0"
          />
        </Row>

        <Row
          id="digest-subjects"
          label="Show subjects in notifications"
          helper="Shows the sender and subject of the first 3 emails. Off shows only a count, which keeps subjects off your lock screen"
        >
          <input
            id="digest-subjects"
            type="checkbox"
            checked={settings.showSubjects}
            aria-describedby="digest-subjects-help"
            onChange={(e) => save({ showSubjects: e.target.checked })}
            className="h-5 w-5 shrink-0"
          />
        </Row>

        <Row
          id="digest-biometric"
          label="Allow Touch ID prompt for the scheduled digest"
          helper="Asks for Touch ID at the scheduled time so the digest email can be sent right away. When off, the email waits until you unlock Pluribus"
        >
          <input
            id="digest-biometric"
            type="checkbox"
            checked={settings.allowBiometricPrompt}
            aria-describedby="digest-biometric-help"
            onChange={(e) => save({ allowBiometricPrompt: e.target.checked })}
            className="h-5 w-5 shrink-0"
          />
        </Row>

        {supportsLoginItem() && (
          <Row
            id="digest-login"
            label="Start Pluribus at login"
            helper="Opens it hidden when you log in, so the daily digest still runs. macOS may ask you to allow it in System Settings → Login Items"
          >
            <input
              id="digest-login"
              type="checkbox"
              checked={settings.launchAtLogin}
              aria-describedby="digest-login-help"
              onChange={(e) => save({ launchAtLogin: e.target.checked })}
              className="h-5 w-5 shrink-0"
            />
          </Row>
        )}
      </div>

      {saveError && (
        <div role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          {saveError}
        </div>
      )}

      <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Sends a digest right now, even if nothing is waiting.
          </div>
          <Button
            variant="outline"
            onClick={handleSendTest}
            disabled={testing}
            className="shrink-0"
          >
            {testing ? 'Sending...' : 'Send test digest now'}
          </Button>
        </div>

        {testError && (
          <div role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
            {testError}
          </div>
        )}

        {testResult && (
          <div
            role="status"
            className="rounded-lg p-3 text-sm space-y-1"
            style={{
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {plural(testResult.totalItems, 'item', 'items')} ·{' '}
              {testResult.notified ? 'notification shown' : 'no notification'}
            </div>
            <ul className="space-y-0.5">
              {testResult.accounts.map((outcome) => (
                <li key={outcome.accountId}>
                  {accountLabel(outcome.accountId)}: {plural(outcome.itemCount, 'item', 'items')},{' '}
                  {EMAIL_OUTCOME[outcome.email]}
                  {outcome.sentHealth === 'no-sent-mail' &&
                    ' (no sent mail found, so check that your Sent folder is syncing)'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
