import { useState, useEffect } from 'react';
import { IconClose, IconTag, IconAdd } from 'obra-icons-react';
import type { Tag } from '../../../core/domain';

type TagManagerProps = {
  currentTags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onClose: () => void;
};

export function TagManager({ currentTags, onAddTag, onRemoveTag, onClose }: TagManagerProps) {
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTags = async () => {
      try {
        const tags = await window.mailApi.tags.list();
        setAvailableTags(tags);
      } catch (err) {
        console.error('Failed to load tags:', err);
      } finally {
        setLoading(false);
      }
    };
    loadTags();
  }, []);

  const filteredTags = availableTags.filter(tag =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    !currentTags.includes(tag.slug)
  );

  const handleAddTag = (tag: Tag) => {
    onAddTag(tag.slug);
    setSearchTerm('');
  };

  const handleCreateAndAdd = () => {
    if (searchTerm.trim()) {
      const slug = searchTerm.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      onAddTag(slug);
      setSearchTerm('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      e.preventDefault();
      handleCreateAndAdd();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-manager-title"
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
            <IconTag className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
            <h2 id="tag-manager-title" className="text-lg font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Manage Tags
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-tertiary)' }}
            aria-label="Close tag manager"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Search input */}
          <div className="mb-4">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search or create tag..."
              className="w-full px-3 py-2 rounded-md outline-none text-sm border"
              style={{
                background: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
              autoFocus
            />
          </div>

          {/* Current Tags */}
          {currentTags.length > 0 && (
            <div className="mb-4">
              <h3
                className="text-xs uppercase tracking-wide mb-2"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Current Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {currentTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => onRemoveTag(tag)}
                    className="px-2.5 py-1 rounded text-sm flex items-center gap-1.5 transition-colors group"
                    style={{
                      background: 'var(--color-accent)',
                      color: 'white',
                    }}
                  >
                    <span>#{tag}</span>
                    <IconClose className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Available Tags */}
          {!loading && filteredTags.length > 0 && (
            <div className="mb-4">
              <h3
                className="text-xs uppercase tracking-wide mb-2"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Available Tags
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleAddTag(tag)}
                    className="w-full px-3 py-2 text-left text-sm rounded-md transition-colors flex items-center justify-between group hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span>#{tag.name}</span>
                    <IconAdd
                      className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create New Tag */}
          {searchTerm && !availableTags.some(t => t.name.toLowerCase() === searchTerm.toLowerCase()) && (
            <div
              className="pt-3 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={handleCreateAndAdd}
                className="w-full px-4 py-2 rounded-md transition-colors flex items-center justify-center gap-1.5 text-sm"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                <IconAdd className="w-3.5 h-3.5" />
                <span>Create "{searchTerm}"</span>
              </button>
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
