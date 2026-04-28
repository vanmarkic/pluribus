import { useEffect, useState } from 'react';

type Status = { total: number; plaintext: number; encrypted: number };

/**
 * Email-body encryption migration panel (#99 follow-up). Shows the
 * fraction of bodies already encrypted and lets the user kick off the
 * background migration.
 */
export function BodyEncryptionPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const s = await window.mailApi.bodyMigration.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('Failed to load migration status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const { total } = await window.mailApi.bodyMigration.start();
      setMessage(
        total === 0
          ? 'Everything is already encrypted — nothing to migrate.'
          : `Migration started for ${total} email bodies.`,
      );
      setTimeout(load, 2_000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Checking encryption status…
      </div>
    );
  }
  if (!status) return null;

  const pct = status.total > 0 ? (status.encrypted / status.total) * 100 : 100;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm space-y-0.5">
          <div style={{ color: 'var(--color-text-primary)' }}>
            {status.encrypted.toLocaleString()} / {status.total.toLocaleString()} bodies encrypted
            <span className="text-sm ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
              ({pct.toFixed(1)}%)
            </span>
          </div>
          <div style={{ color: 'var(--color-text-tertiary)' }}>
            {status.plaintext === 0
              ? 'All cached bodies are AES-256-GCM encrypted at rest.'
              : `${status.plaintext.toLocaleString()} bodies are still plaintext — run the migration to upgrade.`}
          </div>
        </div>

        {status.plaintext > 0 && (
          <button
            type="button"
            onClick={handleStart}
            disabled={running}
            className="px-3 py-1.5 rounded-md text-sm border whitespace-nowrap"
            style={{
              background: 'var(--color-bg)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              opacity: running ? 0.5 : 1,
              cursor: running ? 'wait' : 'pointer',
            }}
          >
            {running ? 'Starting…' : 'Migrate now'}
          </button>
        )}
      </div>

      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-bg-tertiary)' }}
      >
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            height: '100%',
            background: 'var(--color-primary, #3b82f6)',
            transition: 'width 300ms ease-out',
          }}
        />
      </div>

      {message && (
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {message}
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        New bodies are encrypted automatically as they arrive. The migration
        re-saves existing plaintext bodies through the encryption decorator so
        everything on disk carries the <code>v1:</code> AES-GCM envelope.
        Skip it if you'd rather keep debugging / raw-DB inspection easy and
        set <code>PLURIBUS_ENCRYPT_BODIES=0</code> in the environment.
      </div>
    </div>
  );
}
