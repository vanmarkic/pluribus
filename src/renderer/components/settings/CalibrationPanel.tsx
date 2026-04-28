import { useEffect, useState } from 'react';

type LatestFit = {
  id: number;
  fitAt: string;
  a: number;
  b: number;
  fitSize: number;
  eceBefore: number | null;
  eceAfter: number | null;
} | null;

function pct(x: number | null): string {
  if (x === null) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Platt-scaling calibration dashboard (#96). Shows the last fit,
 * before/after ECE, and offers a "recalibrate now" button.
 */
export function CalibrationPanel() {
  const [latest, setLatest] = useState<LatestFit>(null);
  const [loading, setLoading] = useState(true);
  const [recalibrating, setRecalibrating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const row = await window.mailApi.calibration.getLatest();
      setLatest(row);
    } catch (err) {
      console.error('Failed to load calibration:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRecalibrate = async () => {
    setRecalibrating(true);
    setMessage(null);
    try {
      const result = await window.mailApi.calibration.recalibrate();
      if (!result.fitted) {
        setMessage(
          result.fitSize < 50
            ? `Need at least 50 feedback samples to fit — have ${result.fitSize}.`
            : 'Every sample is the same label; cannot fit a meaningful model yet.',
        );
      } else {
        setMessage(
          `Fitted on ${result.fitSize} samples. ECE ${pct(result.eceBefore)} → ${pct(result.eceAfter)}.`,
        );
        await load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRecalibrating(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading calibration…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm space-y-0.5">
          {latest ? (
            <>
              <div style={{ color: 'var(--color-text-primary)' }}>
                Active Platt model: <code>a={latest.a.toFixed(3)}, b={latest.b.toFixed(3)}</code>
              </div>
              <div style={{ color: 'var(--color-text-tertiary)' }}>
                Fit on {latest.fitSize.toLocaleString()} samples on{' '}
                {new Date(latest.fitAt).toLocaleString()}
              </div>
              <div style={{ color: 'var(--color-text-secondary)' }}>
                ECE: <strong>{pct(latest.eceBefore)}</strong> →{' '}
                <strong style={{ color: 'var(--color-primary, #3b82f6)' }}>
                  {pct(latest.eceAfter)}
                </strong>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              No calibration fit yet. Raw LLM confidence is passed through unchanged.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleRecalibrate}
          disabled={recalibrating}
          className="px-3 py-1.5 rounded-md text-sm border whitespace-nowrap"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            opacity: recalibrating ? 0.5 : 1,
            cursor: recalibrating ? 'wait' : 'pointer',
          }}
        >
          {recalibrating ? 'Fitting…' : 'Recalibrate now'}
        </button>
      </div>

      {message && (
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {message}
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        Calibration fits a one-dimensional logistic on pairs of
        (raw LLM confidence, user accept/dismiss). Lower ECE after the fit
        means the classifier's self-reported probability tracks empirical
        accuracy more closely. Applied automatically to every new
        classification as it arrives.
      </div>
    </div>
  );
}
