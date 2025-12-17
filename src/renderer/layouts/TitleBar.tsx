import { useRef, useState, useCallback, useMemo } from 'react';
import { IconSearch, IconClose } from 'obra-icons-react';
import { debounce } from '../utils/debounce';
import { useAccountStore, useEmailStore } from '../stores';

type ClassificationProgress = {
  processed: number;
  total: number;
};

type TitleBarProps = {
  classificationProgress?: ClassificationProgress | null;
};

/**
 * TitleBar Component
 * macOS-style title bar with drag region, search bar, and classification progress indicator
 */
export function TitleBar({ classificationProgress }: TitleBarProps) {
  const { selectedAccountId } = useAccountStore();
  const { search, clearFilter } = useEmailStore();
  const [searchInput, setSearchInput] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounced search function
  const debouncedSearch = useMemo(
    () =>
      debounce((query: string) => {
        if (selectedAccountId) {
          search(query, selectedAccountId);
        }
      }, 300),
    [selectedAccountId, search]
  );

  // Handle search input change
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchInput(query);
      if (query.trim()) {
        debouncedSearch(query.trim());
      } else if (selectedAccountId) {
        // Clear search when input is empty
        debouncedSearch.cancel();
        clearFilter(selectedAccountId);
      }
    },
    [debouncedSearch, selectedAccountId, clearFilter]
  );

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    debouncedSearch.cancel();
    if (selectedAccountId) {
      clearFilter(selectedAccountId);
    }
    searchInputRef.current?.focus();
  }, [debouncedSearch, selectedAccountId, clearFilter]);

  return (
    <div
      className="h-10 shrink-0 flex items-center"
      style={{
        WebkitAppRegion: 'drag',
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
      } as React.CSSProperties}
    >
      {/* Space for traffic lights (left) */}
      <div className="w-20" />

      {/* Search Bar */}
      <div
        className="flex-1 max-w-md mx-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <IconSearch
            className="w-4 h-4 shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleClearSearch();
                e.currentTarget.blur();
              }
            }}
            placeholder="Search emails..."
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: 'var(--color-text)' }}
          />
          {searchInput && (
            <button
              onClick={handleClearSearch}
              className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
              title="Clear search (Esc)"
            >
              <IconClose
                className="w-4 h-4"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
            </button>
          )}
          <span
            className="text-xs shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            /
          </span>
        </div>
      </div>

      {/* Spacer to balance the layout */}
      <div className="flex-1" />

      {/* Classification progress indicator */}
      {classificationProgress && (
        <div
          className="flex items-center gap-2 text-sm px-3 py-1 rounded-full"
          style={{
            WebkitAppRegion: 'no-drag',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-secondary)',
          } as React.CSSProperties}
        >
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: 'var(--color-accent)' }}
          />
          <span>
            Classifying {classificationProgress.processed}/{classificationProgress.total} emails
          </span>
        </div>
      )}
    </div>
  );
}
