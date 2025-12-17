/**
 * Reclassify Confirmation Modal (Issue #56)
 *
 * Shows previous classification info and asks user to confirm
 * before re-running AI classification on an email.
 */

import { useState } from 'react';
import { IconSparkles, IconFolder, IconClose, IconSpinnerBall } from 'obra-icons-react';
import { Button } from './ui/button';

type ClassificationInfo = {
  emailId: number;
  status: string;
  confidence: number | null;
  suggestedFolder: string | null;
  reasoning: string | null;
  classifiedAt: string | null;
};

type ReclassifyResult = {
  previousFolder: string | null;
  previousConfidence: number | null;
  newFolder: string;
  newConfidence: number;
  reasoning: string;
};

type ReclassifyConfirmModalProps = {
  emailId: number;
  emailSubject: string;
  classification: ClassificationInfo | null;
  onConfirm: () => Promise<ReclassifyResult>;
  onClose: () => void;
};

const FOLDER_LABELS: Record<string, string> = {
  'INBOX': 'Inbox',
  'Planning': 'Planning',
  'Review': 'Review',
  'Paper-Trail/Invoices': 'Invoices',
  'Paper-Trail/Admin': 'Admin',
  'Paper-Trail/Travel': 'Travel',
  'Feed': 'Feed',
  'Social': 'Social',
  'Promotions': 'Promotions',
  'Archive': 'Archive',
};

export function ReclassifyConfirmModal({
  emailSubject,
  classification,
  onConfirm,
  onClose,
}: ReclassifyConfirmModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReclassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await onConfirm();
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reclassification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const formatConfidence = (conf: number | null) => {
    if (conf === null) return 'N/A';
    return `${Math.round(conf * 100)}%`;
  };

  const getFolderLabel = (folder: string | null) => {
    if (!folder) return 'None';
    return FOLDER_LABELS[folder] || folder;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Result view after reclassification completes
  if (result) {
    const folderChanged = result.previousFolder !== result.newFolder;

    return (
      <div
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl p-6"
          style={{ background: 'var(--color-bg)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          >
            <IconClose className="w-5 h-5" style={{ color: 'var(--color-text-tertiary)' }} />
          </button>

          <div className="text-center mb-6">
            <div
              className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{ background: 'var(--color-success)', color: 'white' }}
            >
              <IconSparkles className="w-6 h-6" />
            </div>
            <h2
              className="text-xl font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Reclassification Complete
            </h2>
          </div>

          {/* Result Summary */}
          <div
            className="rounded-lg p-4 mb-4"
            style={{ background: 'var(--color-bg-secondary)' }}
          >
            {folderChanged ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                    Moved from
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-sm line-through"
                    style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
                  >
                    {getFolderLabel(result.previousFolder)}
                  </span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>→</span>
                  <span
                    className="px-2 py-0.5 rounded text-sm font-medium"
                    style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}
                  >
                    {getFolderLabel(result.newFolder)}
                  </span>
                </div>
                <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Confidence: {formatConfidence(result.newConfidence)}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <IconFolder className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
                  <span
                    className="text-lg font-medium"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {getFolderLabel(result.newFolder)}
                  </span>
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  Same folder as before (confidence: {formatConfidence(result.newConfidence)})
                </p>
              </div>
            )}
          </div>

          {/* Reasoning */}
          {result.reasoning && (
            <div
              className="rounded-lg p-3 mb-4 text-sm"
              style={{
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span className="font-medium">Reasoning: </span>
              {result.reasoning}
            </div>
          )}

          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  // Confirmation view before reclassification
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl p-6"
        style={{ background: 'var(--color-bg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          disabled={isLoading}
        >
          <IconClose className="w-5 h-5" style={{ color: 'var(--color-text-tertiary)' }} />
        </button>

        <div className="text-center mb-6">
          <div
            className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            <IconSparkles className="w-6 h-6" />
          </div>
          <h2
            className="text-xl font-semibold mb-1"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Reclassify Email?
          </h2>
          <p
            className="text-sm truncate max-w-sm mx-auto"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={emailSubject}
          >
            {emailSubject}
          </p>
        </div>

        {/* Previous Classification Info */}
        {classification && classification.suggestedFolder && (
          <div
            className="rounded-lg p-4 mb-4"
            style={{ background: 'var(--color-bg-secondary)' }}
          >
            <h3
              className="text-sm font-medium mb-3"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Current Classification
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-tertiary)' }}>Folder</span>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                  <IconFolder className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                  {getFolderLabel(classification.suggestedFolder)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-tertiary)' }}>Confidence</span>
                <span style={{ color: 'var(--color-text-primary)' }}>
                  {formatConfidence(classification.confidence)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-tertiary)' }}>Classified</span>
                <span style={{ color: 'var(--color-text-primary)' }}>
                  {formatDate(classification.classifiedAt)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* What Will Happen */}
        <div
          className="rounded-lg p-4 mb-4 text-sm"
          style={{
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <p className="mb-2">Running classification again will:</p>
          <ul className="list-disc ml-4 space-y-1">
            <li>Use current AI model settings</li>
            <li>Consider your training examples</li>
            <li>May assign a different folder</li>
            <li>Move the email if folder changes</li>
          </ul>
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-lg p-3 mb-4 text-sm"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--color-danger)',
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <IconSpinnerBall className="w-4 h-4 mr-2 animate-spin" />
                Classifying...
              </>
            ) : (
              'Reclassify'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
