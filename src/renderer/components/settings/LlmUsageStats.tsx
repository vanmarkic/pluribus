import { useEffect, useState } from 'react';

type Stats = {
  totalCalls: number;
  totalCostUsd: number;
  todayCalls: number;
  todayCostUsd: number;
  monthCostUsd: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
};

type RecentCall = {
  id: number;
  ts: string;
  provider: string;
  model: string;
  emailId: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  costUsd: number;
  cacheHit: boolean;
  stopReason: string | null;
  error: string | null;
};

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Cost & performance dashboard for the LLM classifier (#94).
 * Reads from the `llm_calls` table populated on every classify call.
 */
export function LlmUsageStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [s, r] = await Promise.all([
          window.mailApi.llmCalls.getStats(),
          window.mailApi.llmCalls.listRecent(10),
        ]);
        if (cancelled) return;
        setStats(s);
        setRecent(r);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading usage stats…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-danger, #c00)' }}>
        Failed to load usage: {error}
      </div>
    );
  }

  if (!stats || stats.totalCalls === 0) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        No LLM classifications yet. Stats appear here after the first classify call.
      </div>
    );
  }

  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Spend today', value: formatCost(stats.todayCostUsd), sub: `${stats.todayCalls} calls` },
    { label: 'Spend this month', value: formatCost(stats.monthCostUsd) },
    { label: 'Cache hit rate', value: formatPct(stats.cacheHitRate), sub: 'across all time' },
    { label: 'Avg latency', value: `${stats.avgLatencyMs} ms` },
    { label: 'Total calls', value: stats.totalCalls.toLocaleString() },
    { label: 'Total cost', value: formatCost(stats.totalCostUsd) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="p-3 rounded-md border"
            style={{
              background: 'var(--color-bg-tertiary)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
              {card.label}
            </div>
            <div
              className="text-lg font-semibold mt-1"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {card.value}
            </div>
            {card.sub && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {card.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Recent calls
          </div>
          <div
            className="rounded-md border overflow-hidden text-xs"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <table className="w-full">
              <thead style={{ background: 'var(--color-bg-tertiary)' }}>
                <tr style={{ color: 'var(--color-text-tertiary)' }}>
                  <th className="text-left px-2 py-1 font-normal">Time</th>
                  <th className="text-left px-2 py-1 font-normal">Model</th>
                  <th className="text-right px-2 py-1 font-normal">Tokens</th>
                  <th className="text-right px-2 py-1 font-normal">Latency</th>
                  <th className="text-right px-2 py-1 font-normal">Cost</th>
                  <th className="text-center px-2 py-1 font-normal">Cache</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(c => (
                  <tr
                    key={c.id}
                    style={{
                      color: c.error
                        ? 'var(--color-danger, #c00)'
                        : 'var(--color-text-secondary)',
                      borderTop: '1px solid var(--color-border)',
                    }}
                  >
                    <td className="px-2 py-1 whitespace-nowrap">
                      {new Date(c.ts).toLocaleTimeString()}
                    </td>
                    <td className="px-2 py-1">{c.model.replace(/^claude-/, '')}</td>
                    <td className="px-2 py-1 text-right">
                      {(c.inputTokens + c.outputTokens).toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-right">{c.latencyMs} ms</td>
                    <td className="px-2 py-1 text-right">{formatCost(c.costUsd)}</td>
                    <td className="px-2 py-1 text-center">{c.cacheHit ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
