/**
 * Triage Review View
 *
 * Three-pane layout for reviewing AI-classified emails:
 * - Left: Email list with confidence indicators
 * - Center: Email content
 * - Right: AI analysis + action buttons
 *
 * Keyboard shortcuts: ↑↓ navigate, A accept, D dismiss, E edit folder
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IconCheck, IconClose, IconChevronUp, IconChevronDown,
  IconEdit, IconSparkles
} from 'obra-icons-react';
import { TriageAnalysisPanel } from './TriageAnalysisPanel';
import { EmailViewer } from './EmailViewer';
import { useEmailStore, useAccountStore } from '../stores';
import type { Email, TriageClassificationResult, TriageFolder } from '../../core/domain';

type TriageItem = {
  email: Email;
  analysis: TriageClassificationResult;
};

type SortField = 'confidence' | 'date' | 'sender';
type SortDirection = 'asc' | 'desc';

const TRIAGE_FOLDERS: { id: TriageFolder; label: string }[] = [
  { id: 'INBOX', label: 'Inbox' },
  { id: 'Planning', label: 'Planning' },
  { id: 'Review', label: 'Review' },
  { id: 'Paper-Trail/Invoices', label: 'Invoices' },
  { id: 'Paper-Trail/Admin', label: 'Admin' },
  { id: 'Paper-Trail/Travel', label: 'Travel' },
  { id: 'Feed', label: 'Feed' },
  { id: 'Social', label: 'Social' },
  { id: 'Promotions', label: 'Promotions' },
];

export function TriageReviewView() {
  const { selectedAccountId } = useAccountStore();
  const { selectedEmail, selectEmail } = useEmailStore();

  const [items, setItems] = useState<TriageItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sortField, setSortField] = useState<SortField>('confidence');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [loading, setLoading] = useState(true);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Load emails pending review (from Review folder)
  useEffect(() => {
    const loadReviewItems = async () => {
      if (!selectedAccountId) return;
      setLoading(true);

      try {
        // Get emails from Review folder that need classification
        const emails = await window.mailApi.emails.list({
          accountId: selectedAccountId,
          folderPath: 'Review',
          limit: 100,
        });

        // Classify each email to get analysis
        const triageItems: TriageItem[] = [];
        for (const email of emails) {
          try {
            const analysis = await window.mailApi.triage.classify(email.id);
            triageItems.push({ email, analysis });
          } catch {
            // If classification fails, add with default analysis
            triageItems.push({
              email,
              analysis: {
                folder: 'Review',
                tags: [],
                confidence: 0,
                patternAgreed: false,
                reasoning: 'Classification pending',
              },
            });
          }
        }

        setItems(triageItems);
      } catch (err) {
        console.error('Failed to load review items:', err);
      } finally {
        setLoading(false);
      }
    };

    loadReviewItems();
  }, [selectedAccountId]);

  // Reset index if out of bounds
  useEffect(() => {
    if (currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(items.length - 1);
    }
  }, [items.length, currentIndex]);

  // Sort items
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'confidence':
          comparison = a.analysis.confidence - b.analysis.confidence;
          break;
        case 'date':
          comparison = a.email.date.getTime() - b.email.date.getTime();
          break;
        case 'sender':
          comparison = a.email.from.address.localeCompare(b.email.from.address);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [items, sortField, sortDirection]);

  const currentItem = sortedItems[currentIndex];

  // Load email body when selection changes
  useEffect(() => {
    if (currentItem) {
      selectEmail(currentItem.email.id);
    }
  }, [currentItem?.email.id, selectEmail]);

  // Handlers
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(i => i.email.id)));
  };

  const handleAccept = useCallback(async (item: TriageItem) => {
    if (!selectedAccountId) return;
    try {
      await window.mailApi.triage.moveToFolder(item.email.id, item.analysis.folder, selectedAccountId);
      setItems(prev => prev.filter(i => i.email.id !== item.email.id));
    } catch (err) {
      console.error('Failed to accept:', err);
    }
  }, [selectedAccountId]);

  const handleDismiss = useCallback(async (item: TriageItem) => {
    if (!selectedAccountId) return;
    try {
      // Move back to INBOX when dismissed
      await window.mailApi.triage.moveToFolder(item.email.id, 'INBOX', selectedAccountId);
      setItems(prev => prev.filter(i => i.email.id !== item.email.id));
    } catch (err) {
      console.error('Failed to dismiss:', err);
    }
  }, [selectedAccountId]);

  const handleChangeFolder = useCallback(async (item: TriageItem, newFolder: TriageFolder) => {
    if (!selectedAccountId) return;
    try {
      // Learn from correction
      await window.mailApi.triage.learnFromCorrection(
        item.email.id,
        item.analysis.folder,
        newFolder,
        selectedAccountId
      );
      // Move to new folder
      await window.mailApi.triage.moveToFolder(item.email.id, newFolder, selectedAccountId);
      setItems(prev => prev.filter(i => i.email.id !== item.email.id));
      setShowFolderPicker(false);
    } catch (err) {
      console.error('Failed to change folder:', err);
    }
  }, [selectedAccountId]);

  const handleBulkAccept = async () => {
    for (const id of selectedIds) {
      const item = items.find(i => i.email.id === id);
      if (item) await handleAccept(item);
    }
    setSelectedIds(new Set());
  };

  const handleBulkDismiss = async () => {
    for (const id of selectedIds) {
      const item = items.find(i => i.email.id === id);
      if (item) await handleDismiss(item);
    }
    setSelectedIds(new Set());
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (currentIndex < sortedItems.length - 1) setCurrentIndex(currentIndex + 1);
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
      }
      if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
        if (currentItem) handleAccept(currentItem);
      }
      if (e.key === 'd' || e.key === 'D') {
        if (currentItem) handleDismiss(currentItem);
      }
      if (e.key === 'e' || e.key === 'E') {
        setShowFolderPicker(true);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggleSelectAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, sortedItems, currentItem, handleAccept, handleDismiss]);

  const getConfidenceDot = (confidence: number) => {
    if (confidence >= 0.85) return 'bg-green-500';
    if (confidence >= 0.5) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Empty state
  if (!loading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
        <IconCheck className="h-12 w-12 mb-4 text-green-500" />
        <h3 className="text-lg font-medium" style={{ color: 'var(--color-text-primary)' }}>
          All caught up!
        </h3>
        <p className="max-w-md text-center mt-2">
          No emails pending review. Great job!
        </p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {/* Toolbar */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between shrink-0 h-12"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Triage Review
            </span>
          </div>
          <div className="h-4 w-px" style={{ background: 'var(--color-border)' }} />
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {items.length} pending
          </span>
          <div className="h-4 w-px" style={{ background: 'var(--color-border)' }} />
          <div className="flex items-center gap-1">
            {(['confidence', 'date', 'sender'] as SortField[]).map(field => (
              <button
                key={field}
                onClick={() => handleSort(field)}
                className="h-7 px-2 text-xs rounded-md flex items-center gap-1 transition-colors"
                style={{
                  background: sortField === field ? 'var(--color-bg-secondary)' : 'transparent',
                  color: sortField === field ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                }}
              >
                {field.charAt(0).toUpperCase() + field.slice(1)}
                {sortField === field && (
                  sortDirection === 'asc' ? <IconChevronUp className="w-3 h-3" /> : <IconChevronDown className="w-3 h-3" />
                )}
              </button>
            ))}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="text-sm mr-2" style={{ color: 'var(--color-text-secondary)' }}>
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleBulkDismiss}
              className="h-8 px-3 text-sm rounded-md border transition-colors hover:bg-red-50"
              style={{ borderColor: 'var(--color-border)', color: '#dc2626' }}
            >
              Dismiss
            </button>
            <button
              onClick={handleBulkAccept}
              className="h-8 px-3 text-sm rounded-md text-white transition-colors"
              style={{ background: 'var(--color-accent)' }}
            >
              Accept Selected
            </button>
          </div>
        )}
      </div>

      {/* Main Content - Three Pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Email List */}
        <div
          className="w-[350px] border-r flex flex-col overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex-1 overflow-y-auto">
            {sortedItems.map((item, index) => {
              const isActive = index === currentIndex;
              const isSelected = selectedIds.has(item.email.id);

              return (
                <div
                  key={item.email.id}
                  onClick={() => setCurrentIndex(index)}
                  className="group px-4 py-3 border-b cursor-pointer transition-colors relative"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: isActive ? 'var(--color-accent-light, rgba(59, 130, 246, 0.1))' : 'var(--color-bg)',
                  }}
                >
                  {isActive && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1"
                      style={{ background: 'var(--color-accent)' }}
                    />
                  )}

                  <div className="flex items-start gap-3">
                    <div className="pt-1" onClick={e => { e.stopPropagation(); toggleSelect(item.email.id); }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-4 h-4 rounded"
                      />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-sm font-medium truncate"
                          style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                        >
                          {item.email.from.name || item.email.from.address}
                        </span>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${getConfidenceDot(item.analysis.confidence)}`} />
                      </div>

                      <div className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                        {item.email.subject}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <span
                          className="text-[10px] h-5 px-1.5 rounded flex items-center"
                          style={{
                            background: isActive ? 'var(--color-accent-light, rgba(59, 130, 246, 0.15))' : 'var(--color-bg-secondary)',
                            color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                          }}
                        >
                          {item.analysis.folder}
                        </span>
                        {item.analysis.tags && item.analysis.tags.length > 0 && (
                          <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            #{item.analysis.tags.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* List Footer */}
          <div
            className="p-2 border-t text-xs flex justify-between items-center"
            style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
          >
            <label className="flex items-center gap-2 pl-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === items.length && items.length > 0}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 rounded"
              />
              <span>Select All</span>
            </label>
            <span>↑↓ navigate</span>
          </div>
        </div>

        {/* Center Pane: Email Content */}
        <div className="flex-1 overflow-hidden min-w-0" style={{ background: 'var(--color-bg)' }}>
          {currentItem && selectedEmail ? (
            <EmailViewer />
          ) : (
            <div className="h-full flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)' }}>
              Select an email to review
            </div>
          )}
        </div>

        {/* Right Pane: AI Analysis + Actions */}
        <div
          className="w-[320px] border-l flex flex-col shrink-0"
          style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}
        >
          <div className="p-4 flex-1 overflow-y-auto">
            {currentItem && <TriageAnalysisPanel analysis={currentItem.analysis} />}
          </div>

          {/* Action Footer */}
          {currentItem && (
            <div
              className="p-4 border-t space-y-3"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleDismiss(currentItem)}
                  className="w-full py-2 px-3 text-sm rounded-lg border flex items-center justify-center gap-2 transition-colors hover:bg-red-50"
                  style={{ borderColor: 'var(--color-border)', color: '#dc2626' }}
                >
                  <IconClose className="w-4 h-4" /> Dismiss (D)
                </button>
                <button
                  onClick={() => handleAccept(currentItem)}
                  className="w-full py-2 px-3 text-sm rounded-lg text-white flex items-center justify-center gap-2 transition-colors"
                  style={{ background: 'var(--color-accent)' }}
                >
                  <IconCheck className="w-4 h-4" /> Accept (A)
                </button>
              </div>
              <button
                onClick={() => setShowFolderPicker(true)}
                className="w-full py-1.5 text-xs rounded-lg flex items-center justify-center gap-2 transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <IconEdit className="w-3 h-3" /> Change Folder (E)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Folder Picker Modal */}
      {showFolderPicker && currentItem && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setShowFolderPicker(false)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-xl shadow-xl p-4"
            style={{ background: 'var(--color-bg)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
              Move to Folder
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {TRIAGE_FOLDERS.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => handleChangeFolder(currentItem, folder.id)}
                  className="p-3 rounded-lg text-left text-sm transition-all border"
                  style={{
                    borderColor: currentItem.analysis.folder === folder.id ? 'var(--color-accent)' : 'var(--color-border)',
                    background: currentItem.analysis.folder === folder.id ? 'var(--color-accent-light, rgba(59, 130, 246, 0.1))' : 'var(--color-bg)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {folder.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowFolderPicker(false)}
              className="w-full mt-4 py-2 text-sm rounded-lg"
              style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
