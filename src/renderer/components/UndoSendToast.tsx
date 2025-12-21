/**
 * UndoSendToast component
 *
 * Displays a toast notification after sending an email with a countdown timer
 * and an "Undo" button to cancel the send before it's finalized.
 */

import { useState, useEffect } from 'react';

interface UndoSendToastProps {
  expiresAt: Date;
  onUndo: () => void;
  onExpire?: () => void;
}

export function UndoSendToast({ expiresAt, onUndo, onExpire }: UndoSendToastProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  if (secondsLeft <= 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 px-4 py-3 rounded-lg shadow-lg z-50"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <span style={{ color: 'var(--color-text-primary)' }}>
        Message sent
      </span>

      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
        style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
      >
        {secondsLeft}
      </div>

      <button
        onClick={onUndo}
        className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
        style={{ background: 'var(--color-accent)', color: 'white' }}
      >
        Undo
      </button>
    </div>
  );
}
