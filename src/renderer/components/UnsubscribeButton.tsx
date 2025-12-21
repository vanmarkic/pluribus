// src/renderer/components/UnsubscribeButton.tsx
import { useState } from 'react';
import { IconNotificationOff } from 'obra-icons-react';

interface UnsubscribeButtonProps {
  listUnsubscribe: string | null;
  listUnsubscribePost?: string | null;
  senderName?: string;
  onUnsubscribe: () => void;
  variant?: 'icon' | 'button';
}

export function UnsubscribeButton({
  listUnsubscribe,
  senderName,
  onUnsubscribe,
  variant = 'icon',
}: UnsubscribeButtonProps) {
  const [showDialog, setShowDialog] = useState(false);

  if (!listUnsubscribe) return null;

  const handleConfirm = () => {
    onUnsubscribe();
    setShowDialog(false);
  };

  return (
    <>
      {variant === 'icon' ? (
        <button
          onClick={() => setShowDialog(true)}
          className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Unsubscribe"
          aria-label="Unsubscribe"
        >
          <IconNotificationOff className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
      ) : (
        <button
          onClick={() => setShowDialog(true)}
          className="text-sm underline"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Unsubscribe
        </button>
      )}

      {showDialog && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setShowDialog(false)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-xl shadow-xl p-6"
            style={{ background: 'var(--color-bg)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              Unsubscribe from {senderName || 'this sender'}?
            </h3>
            <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
              You will no longer receive emails from this mailing list.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDialog(false)}
                className="px-4 py-2 text-sm rounded-lg"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 text-sm rounded-lg text-white"
                style={{ background: 'var(--color-danger)' }}
              >
                Unsubscribe
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
