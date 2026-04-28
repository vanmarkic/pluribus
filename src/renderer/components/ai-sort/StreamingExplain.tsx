import { useEffect, useRef, useState } from 'react';

/**
 * Streaming "explain this classification" panel (#89). Opens an on-demand
 * Anthropic stream and renders the model's reasoning token-by-token.
 *
 * Designed to be dropped next to an email in the AI sort view — the
 * parent owns the lifecycle (mounts when the user clicks "explain",
 * unmounts on close).
 */
export function StreamingExplain({ emailId }: { emailId: number }) {
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { requestId } = await window.mailApi.llm.streamExplain(emailId);
        if (cancelled) return;
        const off = window.mailApi.llm.onStreamEvent(requestId, (event) => {
          if (event.type === 'text') {
            setText(prev => prev + event.delta);
          } else if (event.type === 'done') {
            setDone(true);
          } else if (event.type === 'error') {
            setError(event.message);
            setDone(true);
          }
        });
        cleanupRef.current = off;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, [emailId]);

  if (error) {
    return (
      <div className="text-sm p-3 rounded-md" style={{ color: 'var(--color-danger, #c00)', background: 'var(--color-bg-tertiary)' }}>
        Streaming failed: {error}
      </div>
    );
  }

  return (
    <div
      className="text-sm p-3 rounded-md font-mono whitespace-pre-wrap"
      style={{
        background: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-secondary)',
        borderLeft: '2px solid var(--color-primary, #3b82f6)',
      }}
    >
      {text || (!done && <span style={{ color: 'var(--color-text-tertiary)' }}>Thinking…</span>)}
      {!done && <span className="animate-pulse">▌</span>}
    </div>
  );
}
