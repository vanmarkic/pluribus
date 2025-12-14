/**
 * Email Viewer Component
 *
 * Displays full email with header, tags, and body.
 * Matches reference design with clean layout.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import {
  IconFavorite, IconTag, IconArchiveBox, IconDelete, IconCircleBack, IconCircleForward,
  IconAttachment, IconOptionsHorizontal, IconSparkles
} from 'obra-icons-react';
import { useEmailStore, useUIStore, useTagStore } from '../stores';
import { formatSender } from '../../core/domain';

// Configure DOMPurify for email HTML
const purifyConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'a', 'b', 'i', 'u', 'em', 'strong', 'p', 'br', 'div', 'span',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'hr', 'sub', 'sup',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height',
    'style', 'class', 'id', 'target', 'rel',
    'colspan', 'rowspan', 'align', 'valign',
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG' && node.hasAttribute('src')) {
    const src = node.getAttribute('src') || '';
    if (!src.startsWith('data:') && !src.startsWith('cid:')) {
      node.setAttribute('data-original-src', src);
      node.removeAttribute('src');
      node.setAttribute('alt', '[Image blocked]');
    }
  }
});

export function EmailViewer() {
  const {
    selectedEmail: email,
    selectedBody: body,
    selectedTags,
    selectedAttachments,
    loadingBody,
    toggleStar,
    archive,
    deleteEmail,
    downloadAttachment,
  } = useEmailStore();

  const { tags, applyTag, removeTag } = useTagStore();
  const { openCompose } = useUIStore();
  const { refreshSelectedTags } = useEmailStore();

  // Tag dropdown state
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // AI classification state
  const [isClassifying, setIsClassifying] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
    };
    if (showTagDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTagDropdown]);

  // Get tags not yet applied to this email
  const availableTags = tags.filter(
    t => !t.isSystem && !selectedTags.some(st => st.id === t.id)
  );

  // Handle applying a tag
  const handleApplyTag = async (tagId: number) => {
    if (!email) return;
    await applyTag(email.id, tagId);
    await refreshSelectedTags();
    setShowTagDropdown(false);
  };

  // Handle removing a tag
  const handleRemoveTag = async (tagId: number) => {
    if (!email) return;
    await removeTag(email.id, tagId);
    await refreshSelectedTags();
  };

  // Handle AI classification
  const handleClassify = async () => {
    if (!email || isClassifying) return;
    setIsClassifying(true);
    try {
      await window.mailApi.llm.classifyAndApply(email.id);
      await refreshSelectedTags();
    } catch (error) {
      console.error('Classification failed:', error);
    } finally {
      setIsClassifying(false);
    }
  };

  // Sanitize HTML content
  const sanitizedHtml = useMemo(() => {
    if (!body?.html) return null;
    return DOMPurify.sanitize(body.html, purifyConfig as Parameters<typeof DOMPurify.sanitize>[1]);
  }, [body?.html]);

  if (!email) {
    return (
      <div className="email-viewer">
        <div className="email-viewer-empty">
          <div className="text-center">
            <div className="text-lg mb-1">No email selected</div>
            <div className="text-sm">Select an email to read</div>
          </div>
        </div>
      </div>
    );
  }

  if (loadingBody) {
    return (
      <div className="email-viewer">
        <div className="email-viewer-empty">Loading...</div>
      </div>
    );
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Get tag class for styling
  const getTagClass = (tagSlug: string) => {
    const slug = tagSlug.toLowerCase();
    if (slug.includes('work')) return 'tag-work';
    if (slug.includes('personal')) return 'tag-personal';
    if (slug.includes('design')) return 'tag-design';
    if (slug.includes('github')) return 'tag-github';
    if (slug.includes('development') || slug.includes('dev')) return 'tag-development';
    if (slug.includes('marketing')) return 'tag-marketing';
    if (slug.includes('social')) return 'tag-social';
    if (slug.includes('linkedin')) return 'tag-linkedin';
    return 'tag-work';
  };

  return (
    <div className="email-viewer">
      {/* Header */}
      <div className="email-viewer-header">
        {/* Subject Row with Actions */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="email-viewer-subject flex-1">
            {email.subject || '(no subject)'}
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleStar(email.id)}
              className={`btn btn-icon btn-ghost star-icon ${email.isStarred ? 'starred' : ''}`}
              title={email.isStarred ? 'Unstar' : 'Star'}
            >
              <IconFavorite className="w-5 h-5" />
            </button>
            <button
              onClick={handleClassify}
              disabled={isClassifying}
              className={`btn btn-icon btn-ghost ${isClassifying ? 'animate-pulse' : ''}`}
              title="Classify with AI"
            >
              <IconSparkles className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowTagDropdown(!showTagDropdown)}
              className="btn btn-icon btn-ghost"
              title="Add tag"
            >
              <IconTag className="w-5 h-5" />
            </button>
            <button
              onClick={() => archive(email.id)}
              className="btn btn-icon btn-ghost"
              title="Archive"
            >
              <IconArchiveBox className="w-5 h-5" />
            </button>
            <button
              onClick={() => deleteEmail(email.id)}
              className="btn btn-icon btn-ghost"
              title="Delete"
            >
              <IconDelete className="w-5 h-5" />
            </button>
            <button className="btn btn-icon btn-ghost" title="More">
              <IconOptionsHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Important Badge + Tags */}
        <div className="flex items-center gap-2 mb-4">
          {/* Example important badge - would be based on classification */}
          {email.isStarred && (
            <span className="badge-important">Important</span>
          )}

          {/* Tags (click to remove) */}
          {selectedTags.length > 0 && selectedTags.map(tag => (
            <button
              key={tag.id}
              onClick={() => handleRemoveTag(tag.id)}
              className={`tag ${getTagClass(tag.slug)} cursor-pointer hover:opacity-80`}
              title="Click to remove"
            >
              {tag.name}
              <span className="ml-1 opacity-60">×</span>
            </button>
          ))}

          {/* Add tag button with dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowTagDropdown(!showTagDropdown)}
              className="tag flex items-center gap-1"
              style={{
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-tertiary)',
                border: '1px dashed var(--color-border)'
              }}
            >
              <IconTag className="w-3 h-3" />
              Add tag
            </button>

            {/* Tag dropdown */}
            {showTagDropdown && (
              <div
                className="absolute top-full left-0 mt-1 py-1 rounded-lg shadow-lg z-50"
                style={{
                  background: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-border)',
                  minWidth: '160px'
                }}
              >
                {availableTags.length === 0 ? (
                  <div
                    className="px-3 py-2 text-sm"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    No tags available
                  </div>
                ) : (
                  availableTags.map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => handleApplyTag(tag.id)}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--color-bg-secondary)]"
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sender Info */}
        <div className="email-viewer-meta">
          <div
            className="email-viewer-avatar"
            style={{ background: email.isStarred ? '#f59e0b' : 'var(--color-accent)' }}
          >
            {(email.from.name || email.from.address)[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="email-viewer-from">
              {formatSender(email.from)}
              <span className="email-viewer-email ml-2">
                &lt;{email.from.address}&gt;
              </span>
            </div>
            <div className="email-viewer-date">
              {formatDate(email.date)}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="email-viewer-body">
        <div className="email-viewer-body-content">
          {sanitizedHtml ? (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          ) : body?.text ? (
            <pre className="whitespace-pre-wrap font-sans">
              {body.text}
            </pre>
          ) : (
            <div style={{ color: 'var(--color-text-muted)' }}>No content</div>
          )}

          {/* Attachments */}
          {selectedAttachments.length > 0 && (
            <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <div
                className="flex items-center gap-2 text-sm mb-3"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <IconAttachment className="w-4 h-4" />
                <span>
                  {selectedAttachments.length} Attachment{selectedAttachments.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedAttachments.map((attachment) => {
                  const sizeKB = Math.round(attachment.size / 1024);
                  const sizeMB = (attachment.size / (1024 * 1024)).toFixed(1);
                  const displaySize = sizeKB > 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

                  return (
                    <button
                      key={attachment.id}
                      onClick={() => downloadAttachment(attachment.id)}
                      className="btn btn-secondary"
                      title={`Click to open ${attachment.filename}`}
                    >
                      <IconAttachment className="w-4 h-4" />
                      <span>{attachment.filename}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>({displaySize})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div
        className="flex items-center gap-2 px-6 py-4 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <button
          onClick={() => openCompose('reply', email.id)}
          className="btn btn-primary"
        >
          <IconCircleBack className="w-4 h-4" />
          Reply
        </button>
        <button
          onClick={() => openCompose('forward', email.id)}
          className="btn btn-secondary"
        >
          <IconCircleForward className="w-4 h-4" />
          Forward
        </button>
      </div>
    </div>
  );
}
