/**
 * Security Settings Component
 *
 * Allows user to configure biometric authentication behavior.
 */

import { useState, useEffect } from 'react';
import type { BiometricMode, SecurityConfig, RemoteImagesSetting } from '../../core/ports';

const TIMEOUT_OPTIONS = [
  { label: '15 minutes', value: 15 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '4 hours', value: 4 * 60 * 60 * 1000 },
  { label: '8 hours', value: 8 * 60 * 60 * 1000 },
];

const MODE_OPTIONS: { label: string; value: BiometricMode; description: string }[] = [
  {
    label: 'Every time',
    value: 'always',
    description: 'Require Touch ID for every credential access',
  },
  {
    label: 'Once per session',
    value: 'session',
    description: 'Touch ID once, then access until timeout',
  },
  {
    label: 'After screen lock',
    value: 'lock',
    description: 'Only require Touch ID after screen locks',
  },
  {
    label: 'Never',
    value: 'never',
    description: 'Trust device encryption only',
  },
];

export function SecuritySettings() {
  const [config, setConfig] = useState<SecurityConfig | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [remoteImages, setRemoteImages] = useState<RemoteImagesSetting>('block');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    const [cfg, available, imgSetting] = await Promise.all([
      window.mailApi.security.getConfig(),
      window.mailApi.security.isBiometricAvailable(),
      window.mailApi.images.getSetting(),
    ]);
    setConfig(cfg);
    setBiometricAvailable(available);
    setRemoteImages(imgSetting);
  }

  async function updateRemoteImages(setting: RemoteImagesSetting) {
    setSaving(true);
    try {
      await window.mailApi.images.setSetting(setting);
      setRemoteImages(setting);
    } finally {
      setSaving(false);
    }
  }

  async function updateConfig(updates: Partial<SecurityConfig>) {
    if (!config) return;

    setSaving(true);
    try {
      await window.mailApi.security.setConfig(updates);
      setConfig({ ...config, ...updates });
    } finally {
      setSaving(false);
    }
  }

  async function handleLockNow() {
    await window.mailApi.security.clearSession();
  }

  if (!config) {
    return (
      <div className="p-6" style={{ color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-lg">
      {/* Biometric Mode */}
      <div className="space-y-3">
        <label
          className="block text-sm font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Require Touch ID
          {!biometricAvailable && (
            <span
              className="ml-2 text-xs"
              style={{ color: '#d97706' }}
            >
              (Not available on this device)
            </span>
          )}
        </label>

        <div className="space-y-2">
          {MODE_OPTIONS.map(option => (
            <label
              key={option.value}
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all"
              style={{
                borderColor: config.biometricMode === option.value
                  ? 'var(--color-accent)'
                  : 'var(--color-border)',
                background: config.biometricMode === option.value
                  ? 'var(--color-accent-light)'
                  : 'transparent',
                opacity: !biometricAvailable && option.value !== 'never' ? 0.5 : 1,
                cursor: !biometricAvailable && option.value !== 'never' ? 'not-allowed' : 'pointer',
              }}
            >
              <input
                type="radio"
                name="biometricMode"
                value={option.value}
                checked={config.biometricMode === option.value}
                disabled={!biometricAvailable && option.value !== 'never'}
                onChange={() => updateConfig({ biometricMode: option.value })}
                className="mt-0.5"
              />
              <div>
                <div
                  className="font-medium text-sm"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {option.label}
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Session Timeout */}
      {config.biometricMode === 'session' && (
        <div className="space-y-2">
          <label
            className="block text-sm font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Session timeout
          </label>
          <select
            value={config.sessionTimeoutMs}
            onChange={e => updateConfig({ sessionTimeoutMs: Number(e.target.value) })}
            className="input"
          >
            {TIMEOUT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p
            className="text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            How long before requiring Touch ID again
          </p>
        </div>
      )}

      {/* Lock Now Button */}
      {config.biometricMode !== 'never' && (
        <div>
          <button onClick={handleLockNow} className="btn btn-secondary">
            Lock now
          </button>
          <p
            className="mt-1 text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Clear session and require Touch ID for next access
          </p>
        </div>
      )}

      {/* Require for Send */}
      <div
        className="flex items-center justify-between py-3 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div>
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Require for sending
          </div>
          <div
            className="text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Additional Touch ID when sending email
          </div>
        </div>
        <input
          type="checkbox"
          checked={config.requireForSend}
          onChange={e => updateConfig({ requireForSend: e.target.checked })}
          disabled={!biometricAvailable || config.biometricMode === 'never'}
          className="h-5 w-5"
        />
      </div>

      {/* Privacy: Block Remote Images */}
      <div
        className="flex items-center justify-between py-3 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div>
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Block remote images
          </div>
          <div
            className="text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Prevents tracking pixels and external content loading
          </div>
        </div>
        <input
          type="checkbox"
          checked={remoteImages === 'block'}
          onChange={e => updateRemoteImages(e.target.checked ? 'block' : 'allow')}
          className="h-5 w-5"
        />
      </div>

      {/* Clear Image Cache */}
      <div
        className="py-3 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-sm font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Clear image cache
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Delete all cached remote images
            </div>
          </div>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await window.mailApi.images.clearAllCache();
              } finally {
                setSaving(false);
              }
            }}
            className="btn btn-secondary text-sm"
          >
            Clear cache
          </button>
        </div>
      </div>

      {saving && (
        <div
          className="text-xs"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Saving...
        </div>
      )}
    </div>
  );
}
