import { useState, useEffect, useMemo } from 'react';
import type { ReviewItem } from './types';
import type { TriageFolder } from '../../../core/domain';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { AIAnalysisPanel } from './AIAnalysisPanel';
import { IconArrowLeft, IconArrowRight, IconCheck, IconClose, IconEdit, IconMenu, IconGrid, IconArrowDown, IconArrowUp, IconFolder } from 'obra-icons-react';

type ReviewQueueProps = {
  items: ReviewItem[];
  onAccept: (id: number, folder: TriageFolder) => void;
  onDismiss: (id: number) => void;
  onEdit: (id: number) => void;
  onRefresh: () => void;
};

type SortField = 'confidence' | 'date' | 'sender';
type SortDirection = 'asc' | 'desc';

const FOLDER_LABELS: Record<TriageFolder, string> = {
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

export function ReviewQueue({ items, onAccept, onDismiss, onEdit, onRefresh }: ReviewQueueProps) {
  const [mode, setMode] = useState<'list' | 'single'>('list');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sortField, setSortField] = useState<SortField>('confidence');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    if (currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(items.length - 1);
    }
  }, [items.length, currentIndex]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'confidence':
          comparison = (a.confidence ?? 0) - (b.confidence ?? 0);
          break;
        case 'date':
          comparison = new Date(a.email.date).getTime() - new Date(b.email.date).getTime();
          break;
        case 'sender':
          comparison = a.email.from.address.localeCompare(b.email.from.address);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [items, sortField, sortDirection]);

  const currentItem = sortedItems[currentIndex];

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    const Icon = sortDirection === 'asc' ? IconArrowUp : IconArrowDown;
    return <Icon className="ml-1 inline w-3 h-3" />;
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(i => i.emailId)));
  };

  const handleBulkAccept = async () => {
    for (const emailId of selectedIds) {
      const item = items.find(i => i.emailId === emailId);
      if (item && item.suggestedFolder) {
        await onAccept(item.emailId, item.suggestedFolder);
      }
    }
    setSelectedIds(new Set());
    onRefresh();
  };

  const handleBulkDismiss = async () => {
    for (const emailId of selectedIds) {
      const item = items.find(i => i.emailId === emailId);
      if (item) {
        await onDismiss(item.emailId);
      }
    }
    setSelectedIds(new Set());
    onRefresh();
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleSingleAccept = () => {
    if (!currentItem || !currentItem.suggestedFolder) return;
    onAccept(currentItem.emailId, currentItem.suggestedFolder);
    onRefresh();
  };

  const handleSingleDismiss = () => {
    if (!currentItem) return;
    onDismiss(currentItem.emailId);
    onRefresh();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if in input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if (mode === 'single') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleNext();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrev();
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          e.stopImmediatePropagation(); // Prevent global shortcuts from firing
          handleSingleAccept();
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          e.stopImmediatePropagation();
          handleSingleDismiss();
        } else if (e.key === 'e' || e.key === 'E') {
          e.preventDefault();
          e.stopImmediatePropagation(); // Prevent global 'e' (archive) from firing
          if (currentItem) onEdit(currentItem.emailId);
        }
      } else {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          toggleSelectAll();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, currentIndex, items, selectedIds, currentItem]);

  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <IconCheck className="h-12 w-12 mb-4" style={{ color: 'var(--color-success)' }} />
        <h3 className="text-lg font-medium" style={{ color: 'var(--color-text-primary)' }}>
          No classified emails
        </h3>
        <p className="max-w-md text-center mt-2">Run classification to see emails here.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {/* Toolbar */}
      <div
        className="px-6 py-3 border-b flex items-center justify-between sticky top-0 z-10"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-4">
          {/* Mode Toggle */}
          <div className="flex p-1 rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
            <button
              onClick={() => setMode('list')}
              className={`p-1.5 rounded-md transition-all ${mode === 'list' ? 'shadow-sm' : ''}`}
              style={{
                background: mode === 'list' ? 'var(--color-bg)' : 'transparent',
                color: mode === 'list' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              }}
            >
              <IconMenu className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMode('single')}
              className={`p-1.5 rounded-md transition-all ${mode === 'single' ? 'shadow-sm' : ''}`}
              style={{
                background: mode === 'single' ? 'var(--color-bg)' : 'transparent',
                color: mode === 'single' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              }}
            >
              <IconGrid className="w-4 h-4" />
            </button>
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            {items.length} emails ({items.filter(i => i.status === 'pending_review').length} need review)
          </span>
        </div>

        {/* Bulk Actions */}
        {mode === 'list' && selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="text-sm mr-2" style={{ color: 'var(--color-text-tertiary)' }}>
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkDismiss}
              style={{ color: 'var(--color-danger)' }}
            >
              Dismiss
            </Button>
            <Button size="sm" onClick={handleBulkAccept}>
              Accept Selected
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'list' ? (
          <div className="h-full overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead
                className="text-xs uppercase sticky top-0"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}
              >
                <tr>
                  <th className="px-6 py-3 w-10">
                    <Checkbox
                      checked={selectedIds.size === items.length && items.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-6 py-3 w-20">Status</th>
                  <th
                    className="px-6 py-3 cursor-pointer hover:bg-[var(--color-bg-hover)]"
                    onClick={() => handleSort('confidence')}
                  >
                    Confidence <SortIcon field="confidence" />
                  </th>
                  <th
                    className="px-6 py-3 cursor-pointer hover:bg-[var(--color-bg-hover)]"
                    onClick={() => handleSort('sender')}
                  >
                    Sender & Subject <SortIcon field="sender" />
                  </th>
                  <th className="px-6 py-3">Suggested Folder</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {sortedItems.map((item) => (
                  <tr
                    key={item.emailId}
                    className="transition-colors hover:bg-[var(--color-bg-hover)]"
                  >
                    <td className="px-6 py-4">
                      <Checkbox
                        checked={selectedIds.has(item.emailId)}
                        onCheckedChange={() => toggleSelect(item.emailId)}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={item.status === 'classified' ? 'default' : 'secondary'}
                        className="text-xs font-normal"
                        style={{
                          background: item.status === 'classified' ? 'var(--color-success)' : 'var(--color-warning)',
                          color: 'white',
                        }}
                      >
                        {item.status === 'classified' ? 'Sorted' : 'Review'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            background:
                              (item.confidence ?? 0) >= 0.85 ? 'var(--color-success)' :
                              (item.confidence ?? 0) >= 0.5 ? 'var(--color-warning)' :
                              'var(--color-danger)',
                          }}
                        />
                        <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                          {!isNaN(item.confidence ?? 0) ? `${Math.round((item.confidence ?? 0) * 100)}%` : 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-md">
                      <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {item.email.from.name || item.email.from.address}
                      </div>
                      <div className="truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                        {item.email.subject}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {item.suggestedFolder && (
                        <Badge variant="secondary" className="text-xs font-normal flex items-center gap-1 w-fit">
                          <IconFolder className="w-3 h-3" />
                          {FOLDER_LABELS[item.suggestedFolder] || item.suggestedFolder}
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          style={{ color: 'var(--color-success)' }}
                          onClick={() => {
                            if (item.suggestedFolder) {
                              onAccept(item.emailId, item.suggestedFolder);
                              onRefresh();
                            }
                          }}
                          disabled={!item.suggestedFolder}
                          aria-label="Accept classification"
                        >
                          <IconCheck className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => {
                            onDismiss(item.emailId);
                            onRefresh();
                          }}
                          aria-label="Dismiss classification"
                        >
                          <IconClose className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-full flex overflow-hidden">
            {/* Email Preview */}
            <div
              className="flex-1 overflow-y-auto p-6 border-r"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {currentItem && (
                <div className="max-w-2xl mx-auto">
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {currentItem.email.subject}
                      </h2>
                      <Badge
                        variant={currentItem.status === 'classified' ? 'default' : 'secondary'}
                        className="text-xs font-normal"
                        style={{
                          background: currentItem.status === 'classified' ? 'var(--color-success)' : 'var(--color-warning)',
                          color: 'white',
                        }}
                      >
                        {currentItem.status === 'classified' ? 'Sorted' : 'Review'}
                      </Badge>
                    </div>
                    <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      From: {currentItem.email.from.name || currentItem.email.from.address}
                    </div>
                    <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                      {new Date(currentItem.email.date).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className="p-4 rounded-lg text-sm whitespace-pre-wrap"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {currentItem.email.snippet}
                  </div>
                </div>
              )}
            </div>

            {/* AI Panel + Actions */}
            <div
              className="w-[350px] flex flex-col border-l"
              style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}
            >
              <div className="p-4 flex-1 overflow-y-auto">
                {currentItem && <AIAnalysisPanel classification={currentItem} />}
              </div>

              <div
                className="p-4 border-t space-y-3"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              >
                <div
                  className="flex justify-between items-center text-xs"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <span>Reviewing {currentIndex + 1} of {items.length}</span>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-6 w-6"
                      onClick={handlePrev}
                      disabled={currentIndex === 0}
                      aria-label="Previous email"
                    >
                      <IconArrowLeft className="w-3 h-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-6 w-6"
                      onClick={handleNext}
                      disabled={currentIndex === items.length - 1}
                      aria-label="Next email"
                    >
                      <IconArrowRight className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    style={{ color: 'var(--color-danger)' }}
                    onClick={handleSingleDismiss}
                  >
                    <IconClose className="mr-2 h-4 w-4" /> Dismiss (D)
                  </Button>
                  <Button
                    className="w-full"
                    onClick={handleSingleAccept}
                    disabled={!currentItem?.suggestedFolder}
                  >
                    <IconCheck className="mr-2 h-4 w-4" /> Accept (A)
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  onClick={() => currentItem && onEdit(currentItem.emailId)}
                >
                  <IconEdit className="mr-2 h-3 w-3" /> Edit Folder (E)
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
