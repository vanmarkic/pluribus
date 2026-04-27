import { useEffect, useState } from 'react';

type Stats = {
  totalEmails: number;
  indexed: number;
  coverage: number;
  model: string;
};

/**
 * Semantic-index management panel (#88). Shows how much of the user's
 * mailbox has been embedded into the RAG corpus, and offers a backfill
 * button for existing inboxes.
 */
export function SemanticIndexPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillInfo, setBackfillInfo] = useState<string | null>(null);

  const load = async () => {
    try {
      const s = await window.mailApi.embeddings.getStats();
      setStats(s);
    } catch (err) {
      console.error('Failed to load embedding stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillInfo(null);
    try {
      const { total } = await window.mailApi.embeddings.backfill({ limit: 5000 });
      setBackfillInfo(
        total === 0
          ? 'Nothing to index — every email already has an embedding.'
          : `Indexing ${total} email${total === 1 ? '' : 's'} in the background…`
      );
      // Refresh stats in a moment; the background task will update coverage.
      setTimeout(load, 2000);
    } catch (err) {
      setBackfillInfo(err instanceof Error ? err.message : String(err));
    } finally {
      setBackfilling(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading semantic-index stats…
      </div>
    );
  }

  if (!stats) return null;

  const pct = (stats.coverage * 100).toFixed(1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
            Coverage
          </div>
          <div className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {stats.indexed.toLocaleString()} / {stats.totalEmails.toLocaleString()} emails
            <span className="text-sm ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
              ({pct}%)
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
            model: {stats.model}
          </div>
        </div>
        <button
          type="button"
          onClick={handleBackfill}
          disabled={backfilling}
          className="px-3 py-1.5 rounded-md text-sm border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            opacity: backfilling ? 0.5 : 1,
            cursor: backfilling ? 'wait' : 'pointer',
          }}
        >
          {backfilling ? 'Starting…' : 'Rebuild index'}
        </button>
      </div>

      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-bg-tertiary)' }}
      >
        <div
          style={{
            width: `${Math.min(100, stats.coverage * 100)}%`,
            height: '100%',
            background: 'var(--color-primary, #3b82f6)',
            transition: 'width 200ms ease-out',
          }}
        />
      </div>

      {backfillInfo && (
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {backfillInfo}
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        The semantic index powers "find similar emails" retrieval and the
        agent-loop tools. New emails are indexed automatically after
        classification.
      </div>
    </div>
  );
}
