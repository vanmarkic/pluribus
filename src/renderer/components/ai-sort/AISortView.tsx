import { useState, useEffect, useCallback } from 'react';
import { AIDashboard } from './AIDashboard';
import { ReviewQueue } from './ReviewQueue';
import { TagManager } from './TagManager';
import { useAccountStore } from '../../stores';
import type { ReviewItem } from './types';

export function AISortView() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'review'>('dashboard');
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const { selectedAccountId } = useAccountStore();

  const loadReviewItems = useCallback(async () => {
    try {
      const items = await window.mailApi.aiSort.getPendingReview({
        limit: 100,
        accountId: selectedAccountId || undefined,
      });
      setReviewItems(items);
    } catch (err) {
      console.error('Failed to load review items:', err);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    loadReviewItems();
  }, [loadReviewItems]);

  const editingItem = reviewItems.find(i => i.emailId === editingItemId);

  const handleAccept = async (emailId: number, tags: string[]) => {
    try {
      await window.mailApi.aiSort.accept(emailId, tags);
      await loadReviewItems();
    } catch (err) {
      console.error('Failed to accept:', err);
    }
  };

  const handleDismiss = async (emailId: number) => {
    try {
      await window.mailApi.aiSort.dismiss(emailId);
      await loadReviewItems();
    } catch (err) {
      console.error('Failed to dismiss:', err);
    }
  };

  const handleEdit = (id: number) => {
    setEditingItemId(id);
  };

  const handleAddTag = (tag: string) => {
    if (!editingItem) return;
    // Update local state - the actual tag application happens on accept
    setReviewItems(items =>
      items.map(item =>
        item.emailId === editingItemId
          ? {
              ...item,
              suggestedTags: [...item.suggestedTags, tag],
            }
          : item
      )
    );
  };

  const handleRemoveTag = (tag: string) => {
    if (!editingItem) return;
    setReviewItems(items =>
      items.map(item =>
        item.emailId === editingItemId
          ? {
              ...item,
              suggestedTags: item.suggestedTags.filter((t: string) => t !== tag),
            }
          : item
      )
    );
  };

  const handleClassifyUnprocessed = async () => {
    try {
      const result = await window.mailApi.aiSort.classifyUnprocessed();
      await loadReviewItems();
      return result;
    } catch (err) {
      console.error('Failed to classify unprocessed:', err);
      throw err;
    }
  };

  const handleClearCache = async () => {
    try {
      await window.mailApi.aiSort.clearConfusedPatterns();
    } catch (err) {
      console.error('Failed to clear cache:', err);
    }
  };

  return (
    <div
      className="h-full flex flex-col w-full relative"
      style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
    >
      {/* Content - Dashboard only */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <AIDashboard
            onClassifyUnprocessed={handleClassifyUnprocessed}
            onClearCache={handleClearCache}
            accountId={selectedAccountId || undefined}
          />
        </div>
      </div>

      {/* Tag Manager Modal */}
      {editingItem && (
        <TagManager
          currentTags={editingItem.suggestedTags}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onClose={() => setEditingItemId(null)}
        />
      )}
    </div>
  );
}
