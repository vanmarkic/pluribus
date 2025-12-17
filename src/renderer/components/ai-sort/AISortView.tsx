import { useState, useEffect, useCallback } from 'react';
import { AIDashboard } from './AIDashboard';
import { FolderPicker } from './FolderPicker';
import { useAccountStore } from '../../stores';
import type { ReviewItem } from './types';
import type { TriageFolder } from '../../../core/domain';

export function AISortView() {
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

  const handleSelectFolder = async (folder: TriageFolder) => {
    if (!editingItem) return;
    // Update local state
    setReviewItems(items =>
      items.map(item =>
        item.emailId === editingItemId
          ? { ...item, suggestedFolder: folder }
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

      {/* Folder Picker Modal */}
      {editingItem && (
        <FolderPicker
          currentFolder={editingItem.suggestedFolder}
          onSelectFolder={handleSelectFolder}
          onClose={() => setEditingItemId(null)}
        />
      )}
    </div>
  );
}
