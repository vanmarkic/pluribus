import { useState, useEffect } from 'react';
import { IconClose, IconFolder } from 'obra-icons-react';

// TriageFolder type duplicated here to avoid importing from core/domain
// This maintains Clean Architecture: renderer only communicates via IPC
type TriageFolder =
  | 'INBOX'
  | 'Planning'
  | 'Review'
  | 'Paper-Trail/Invoices'
  | 'Paper-Trail/Admin'
  | 'Paper-Trail/Travel'
  | 'Feed'
  | 'Social'
  | 'Promotions'
  | 'Archive';

type FolderPickerProps = {
  currentFolder: TriageFolder | null;
  onSelectFolder: (folder: TriageFolder) => void;
  onClose: () => void;
};

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

export function FolderPicker({ currentFolder, onSelectFolder, onClose }: FolderPickerProps) {
  const [folders, setFolders] = useState<TriageFolder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.mailApi.config.getTriageFolders()
      .then((f) => setFolders(f as TriageFolder[]))
      .catch((err) => console.error('Failed to load triage folders:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-picker-title"
    >
      <div
        className="rounded-xl w-full max-w-md shadow-xl overflow-hidden border"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            <IconFolder className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
            <h2 id="folder-picker-title" className="text-lg font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Select Folder
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-tertiary)' }}
            aria-label="Close folder picker"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>
              Loading folders...
            </p>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => {
                    onSelectFolder(folder);
                    onClose();
                  }}
                  className={`w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center justify-between ${
                    currentFolder === folder ? 'bg-[var(--color-accent)]' : 'hover:bg-[var(--color-bg-hover)]'
                  }`}
                  style={{
                    color: currentFolder === folder ? 'white' : 'var(--color-text-secondary)',
                  }}
                >
                  <span className="flex items-center gap-2">
                    <IconFolder className="w-4 h-4" />
                    {FOLDER_LABELS[folder] || folder}
                  </span>
                  {currentFolder === folder && (
                    <span className="text-xs">Current</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t text-center"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Press <kbd
              className="px-1.5 py-0.5 rounded text-xs border"
              style={{
                background: 'var(--color-bg)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
            >Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}
