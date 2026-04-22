import { useEffect, useMemo, useState } from 'react';

type Severity = 'info' | 'warn' | 'alert' | '';

type Event = {
  id: number;
  ts: string;
  eventType: string;
  severity: 'info' | 'warn' | 'alert';
  actor: string;
  target: string | null;
  success: boolean;
  metadata: Record<string, unknown>;
};

const SEVERITY_COLOR: Record<'info' | 'warn' | 'alert', string> = {
  info: 'var(--color-text-tertiary)',
  warn: '#c88a00',
  alert: '#c00',
};

/**
 * Security audit-log panel (#98). Read-only timeline of credential access,
 * prompt-injection findings, and classifier fallback transitions.
 */
export function SecurityLogPanel() {
  const [events, setEvents] = useState<Event[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<Severity>('');

  const load = async () => {
    try {
      const [list, byType] = await Promise.all([
        window.mailApi.securityEvents.listRecent({
          limit: 100,
          ...(severity ? { severity } : {}),
        }),
        window.mailApi.securityEvents.countByType(),
      ]);
      setEvents(list);
      setCounts(byType);
    } catch (err) {
      console.error('Failed to load security events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity]);

  const topTypes = useMemo(() => {
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [counts]);

  if (loading) {
    return <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading audit log…</div>;
  }

  return (
    <div className="space-y-3">
      {topTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topTypes.map(([type, n]) => (
            <span
              key={type}
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-tertiary)',
              }}
            >
              {type}: <strong>{n}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Severity:</span>
        {(['', 'info', 'warn', 'alert'] as Severity[]).map(sev => (
          <button
            key={sev || 'all'}
            onClick={() => setSeverity(sev)}
            className="text-xs px-2 py-0.5 rounded-md border"
            style={{
              borderColor: 'var(--color-border)',
              background: severity === sev ? 'var(--color-bg-tertiary)' : 'var(--color-bg)',
              color: 'var(--color-text-primary)',
            }}
          >
            {sev || 'all'}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          No events recorded yet. The audit log populates as credentials are
          accessed, prompt-injection attempts are detected, or the classifier
          falls back between model tiers.
        </div>
      ) : (
        <div
          className="rounded-md border overflow-hidden text-xs"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <table className="w-full">
            <thead style={{ background: 'var(--color-bg-tertiary)' }}>
              <tr style={{ color: 'var(--color-text-tertiary)' }}>
                <th className="text-left px-2 py-1 font-normal">Time</th>
                <th className="text-left px-2 py-1 font-normal">Severity</th>
                <th className="text-left px-2 py-1 font-normal">Event</th>
                <th className="text-left px-2 py-1 font-normal">Actor</th>
                <th className="text-left px-2 py-1 font-normal">Target</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr
                  key={e.id}
                  style={{
                    color: 'var(--color-text-secondary)',
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  <td className="px-2 py-1 whitespace-nowrap">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td
                    className="px-2 py-1 whitespace-nowrap"
                    style={{ color: SEVERITY_COLOR[e.severity] }}
                  >
                    {e.severity}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {e.eventType}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">{e.actor}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{e.target ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
