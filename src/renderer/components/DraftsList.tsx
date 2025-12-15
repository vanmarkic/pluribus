/**
 * Drafts List Component
 *
 * Displays local drafts with subject, recipients, and saved date.
 * Clicking a draft opens ComposeModal for editing.
 */

import { useEffect, useState } from 'react';
import { IconDocument, IconDelete } from 'obra-icons-react';
import { useUIStore } from '../stores';
import type { Draft } from '../../core/domain';

export function DraftsList() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { openComposeDraft } = useUIStore();

  // Load drafts on mount and listen for changes
  useEffect(() => {
    loadDrafts();

    // Listen for draft changes from ComposeModal
    const handleDraftsChanged = () => {
      loadDrafts();
    };
    window.addEventListener('drafts:changed', handleDraftsChanged);

    return () => {
      window.removeEventListener('drafts:changed', handleDraftsChanged);
    };
  }, []);

  const loadDrafts = async () => {
    try {
      setLoading(true);
      const list = await window.mailApi.drafts.list();
      setDrafts(list);
    } catch (error) {
      console.error('Failed to load drafts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, draftId: number) => {
    e.stopPropagation();
    try {
      await window.mailApi.drafts.delete(draftId);
      setDrafts(drafts.filter(d => d.id !== draftId));
      if (selectedId === draftId) {
        setSelectedId(null);
      }
      // Notify other components (Sidebar) to update their counts
      window.dispatchEvent(new CustomEvent('drafts:changed'));
    } catch (error) {
      console.error('Failed to delete draft:', error);
    }
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 24) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (diffHours < 24 * 7) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatRecipients = (draft: Draft) => {
    const recipients = [...draft.to, ...draft.cc, ...draft.bcc];
    if (recipients.length === 0) return '(no recipients)';
    if (recipients.length === 1) return recipients[0];
    return `${recipients[0]} +${recipients.length - 1}`;
  };

  return (
    <div className="email-list">
      {/* Header */}
      <div className="email-list-header">
        <h2 className="email-list-title">Drafts</h2>
        <span className="email-list-count">{drafts.length} drafts</span>
      </div>

      {/* Drafts List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            Loading...
          </div>
        ) : drafts.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            <IconDocument className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No drafts</p>
            <p className="text-sm mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              Compose a new email and it will be saved here automatically
            </p>
          </div>
        ) : (
          drafts.map(draft => (
            <div
              key={draft.id}
              onClick={() => {
                setSelectedId(draft.id);
                openComposeDraft(draft.id);
              }}
              className={`email-item ${selectedId === draft.id ? 'selected' : ''}`}
            >
              {/* Header row: Recipients + Delete + Date */}
              <div className="email-item-header">
                <div className="flex items-center gap-2">
                  <span className="email-item-sender">
                    {formatRecipients(draft)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDelete(e, draft.id)}
                    className="p-1 rounded transition-colors hover:bg-[var(--color-danger-bg,rgba(239,68,68,0.1))]"
                    style={{ color: 'var(--color-text-tertiary)' }}
                    title="Delete draft"
                  >
                    <IconDelete className="w-4 h-4" />
                  </button>
                  <span className="email-item-date">{formatDate(draft.savedAt)}</span>
                </div>
              </div>

              {/* Subject */}
              <div className="email-item-subject">
                {draft.subject || '(no subject)'}
              </div>

              {/* Preview */}
              <div className="email-item-snippet">
                {draft.text?.slice(0, 100) || draft.html?.replace(/<[^>]*>/g, '').slice(0, 100) || '(empty)'}
              </div>

              {/* Draft badge */}
              <div className="email-item-tags">
                <span
                  className="tag"
                  style={{
                    background: 'var(--color-warning-bg)',
                    color: 'var(--color-warning)',
                  }}
                >
                  Draft
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
