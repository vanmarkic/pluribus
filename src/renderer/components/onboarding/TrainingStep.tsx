/**
 * Training Step Component
 *
 * Onboarding step where users classify sample emails to train the triage AI.
 * Shows 5 emails, user selects destination folder for each.
 */

import { useState, useEffect } from 'react';
import { IconCheck, IconChevronRight, IconClose } from 'obra-icons-react';
import type { Email } from '../../../core/domain';

const TRIAGE_FOLDERS = [
  { id: 'INBOX', label: 'Inbox', description: 'Urgent, needs response today' },
  { id: 'Planning', label: 'Planning', description: 'Medium-term, no hard deadline' },
  { id: 'Paper-Trail/Invoices', label: 'Invoices', description: 'Receipts, payment confirmations' },
  { id: 'Paper-Trail/Admin', label: 'Admin', description: 'Contracts, legal, support' },
  { id: 'Paper-Trail/Travel', label: 'Travel', description: 'Bookings, itineraries' },
  { id: 'Feed', label: 'Feed', description: 'Newsletters, curated content' },
  { id: 'Social', label: 'Social', description: 'Social media notifications' },
  { id: 'Promotions', label: 'Promotions', description: 'Marketing, sales, discounts' },
];

type TrainingItem = {
  email: Email;
  selectedFolder: string | null;
};

type TrainingStepProps = {
  accountId: number;
  onComplete: () => void;
  onSkip: () => void;
};

export function TrainingStep({ accountId, onComplete, onSkip }: TrainingStepProps) {
  const [items, setItems] = useState<TrainingItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sample emails
  useEffect(() => {
    const loadSamples = async () => {
      try {
        // Get recent emails for training (varied senders)
        const emails = await window.mailApi.emails.list({
          accountId,
          limit: 20,
        });

        // Select 5 diverse emails (different senders/domains)
        const seenDomains = new Set<string>();
        const selected: Email[] = [];

        for (const email of emails) {
          const domain = email.from.address.split('@')[1];
          if (!seenDomains.has(domain) && selected.length < 5) {
            seenDomains.add(domain);
            selected.push(email);
          }
        }

        // If we couldn't get 5 unique domains, fill with remaining
        for (const email of emails) {
          if (selected.length >= 5) break;
          if (!selected.includes(email)) {
            selected.push(email);
          }
        }

        setItems(selected.map(email => ({ email, selectedFolder: null })));
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load emails');
        setLoading(false);
      }
    };

    loadSamples();
  }, [accountId]);

  const handleFolderSelect = (folder: string) => {
    setItems(prev =>
      prev.map((item, i) =>
        i === currentIndex ? { ...item, selectedFolder: folder } : item
      )
    );
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    setError(null);

    try {
      // Save each classified email as a training example
      for (const item of items) {
        if (item.selectedFolder) {
          await window.mailApi.triage.saveTrainingExample({
            accountId,
            emailId: item.email.id,
            fromAddress: item.email.from.address,
            fromDomain: item.email.from.address.split('@')[1],
            subject: item.email.subject,
            aiSuggestion: null, // No AI suggestion during initial training
            userChoice: item.selectedFolder,
            wasCorrection: false,
            source: 'onboarding',
          });
        }
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save training');
      setSaving(false);
    }
  };

  const completedCount = items.filter(i => i.selectedFolder).length;
  const canComplete = completedCount >= 3; // Require at least 3 classifications
  const currentItem = items[currentIndex];

  if (loading) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }}
      >
        <div
          className="relative w-full max-w-lg mx-4 rounded-2xl shadow-2xl p-8 text-center"
          style={{ background: 'var(--color-bg)' }}
        >
          <div
            className="w-8 h-8 mx-auto rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
          />
          <p className="mt-4" style={{ color: 'var(--color-text-secondary)' }}>
            Loading sample emails...
          </p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }}
      >
        <div
          className="relative w-full max-w-lg mx-4 rounded-2xl shadow-2xl p-8"
          style={{ background: 'var(--color-bg)' }}
        >
          <div className="text-center">
            <h1
              className="text-2xl font-semibold mb-2"
              style={{ color: 'var(--color-text-primary)' }}
            >
              No Emails Yet
            </h1>
            <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>
              We need some emails to train the AI. Sync your mailbox first, then come back to set up triage.
            </p>
            <button
              onClick={onSkip}
              className="py-2.5 px-6 rounded-lg font-medium"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              Continue Without Training
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }}
    >
      <div
        className="relative w-full max-w-2xl mx-4 rounded-2xl shadow-2xl"
        style={{ background: 'var(--color-bg)', maxHeight: '90vh', overflow: 'hidden' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <h1
              className="text-xl font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Train Your Email Triage
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Classify {items.length} emails to teach the AI your preferences
            </p>
          </div>
          <button
            onClick={onSkip}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
            title="Skip training"
          >
            <IconClose
              className="w-5 h-5"
              style={{ color: 'var(--color-text-tertiary)' }}
            />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 py-3" style={{ background: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Email {currentIndex + 1} of {items.length}
            </span>
            <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              ({completedCount} classified)
            </span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--color-border)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${(completedCount / items.length) * 100}%`,
                background: 'var(--color-accent)',
              }}
            />
          </div>
        </div>

        {/* Email preview */}
        <div className="px-6 py-4">
          <div
            className="rounded-lg p-4 mb-4"
            style={{ background: 'var(--color-bg-secondary)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium shrink-0"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                {currentItem.email.from.name?.[0] || currentItem.email.from.address[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {currentItem.email.from.name || currentItem.email.from.address}
                </div>
                <div
                  className="text-sm truncate"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {currentItem.email.from.address}
                </div>
              </div>
            </div>
            <div
              className="mt-3 font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {currentItem.email.subject}
            </div>
          </div>

          {/* Folder selection grid */}
          <div className="grid grid-cols-2 gap-2">
            {TRIAGE_FOLDERS.map(folder => (
              <button
                key={folder.id}
                onClick={() => handleFolderSelect(folder.id)}
                className="p-3 rounded-lg text-left transition-all"
                style={{
                  background:
                    currentItem.selectedFolder === folder.id
                      ? 'var(--color-accent-light, rgba(59, 130, 246, 0.1))'
                      : 'var(--color-bg-secondary)',
                  border: `2px solid ${
                    currentItem.selectedFolder === folder.id
                      ? 'var(--color-accent)'
                      : 'transparent'
                  }`,
                }}
              >
                <div className="flex items-center gap-2">
                  {currentItem.selectedFolder === folder.id && (
                    <IconCheck className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                  )}
                  <span
                    className="font-medium text-sm"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {folder.label}
                  </span>
                </div>
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {folder.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mx-6 mb-4 rounded-lg p-3 text-sm"
            style={{
              background: '#fef2f2',
              color: '#dc2626',
              border: '1px solid #fecaca',
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex items-center justify-between"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="py-2 px-4 rounded-lg font-medium disabled:opacity-50"
            style={{
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Previous
          </button>

          <div className="flex gap-3">
            {currentIndex < items.length - 1 ? (
              <button
                onClick={handleNext}
                disabled={!currentItem.selectedFolder}
                className="py-2 px-4 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                Next
                <IconChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={!canComplete || saving}
                className="py-2 px-4 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                {saving ? 'Saving...' : 'Complete Training'}
                <IconCheck className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
