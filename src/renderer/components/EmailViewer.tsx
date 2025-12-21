/**
 * Email Viewer Component
 *
 * Displays full email with header, tags, and body.
 * Matches reference design with clean layout.
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import {
  IconFavorite, IconArchiveBox, IconDelete, IconCircleBack, IconCircleForward,
  IconAttachment, IconOptionsHorizontal, IconSparkles, IconImage, IconSpinnerBall
} from 'obra-icons-react';
// useTagStore removed - using folders for organization (Issue #54)
import { useEmailStore, useUIStore } from '../stores';
import { formatSender } from '../../core/domain';
import { ReclassifyConfirmModal } from './ReclassifyConfirmModal';

/**
 * Shadow DOM wrapper for email HTML content.
 * Provides true CSS isolation - app styles cannot leak into email content.
 */
interface ShadowContentProps {
  html: string;
  className?: string;
  shadowRootRef?: React.MutableRefObject<ShadowRoot | null>;
}

function ShadowContent({ html, className, shadowRootRef: externalShadowRef }: ShadowContentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const internalShadowRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    // Create shadow root once
    if (!internalShadowRef.current) {
      internalShadowRef.current = hostRef.current.attachShadow({ mode: 'open' });
      // Expose shadow root to parent if requested
      if (externalShadowRef) {
        externalShadowRef.current = internalShadowRef.current;
      }
    }

    // Minimal styles for email content readability
    const styles = `
      :host {
        display: block;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
        line-height: 1.6;
        color: #374151;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        color: #2563eb;
      }
      pre {
        overflow-x: auto;
        background: #f3f4f6;
        padding: 1em;
        border-radius: 4px;
      }
      blockquote {
        border-left: 3px solid #e5e7eb;
        margin-left: 0;
        padding-left: 1em;
        color: #6b7280;
      }
      table {
        border-collapse: collapse;
      }
      td, th {
        padding: 0.5em;
      }
    `;

    internalShadowRef.current.innerHTML = `<style>${styles}</style>${html}`;
  }, [html, externalShadowRef]);

  return <div ref={hostRef} className={className} />;
}

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
    'data-original-src', // Allow our custom attribute
  ],
  ALLOW_DATA_ATTR: true, // Allow data-* attributes
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
};

/**
 * Sanitize HTML and optionally extract blocked remote image URLs.
 *
 * This function wraps DOMPurify.sanitize to capture remote image URLs
 * before they're blocked. We use a scoped approach rather than global
 * hooks to avoid timing issues with hook reset.
 *
 * @param html - The HTML to sanitize
 * @param blockRemoteImages - Whether to block remote images (default: true)
 */
function sanitizeEmailHtml(html: string, blockRemoteImages = true): { sanitized: string; blockedUrls: string[] } {
  const blockedUrls: string[] = [];

  // Clear any existing hooks (important for HMR)
  DOMPurify.removeAllHooks();

  // Capture IMG src before DOMPurify processes attributes
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'img' || data.tagName === 'IMG') {
      const el = node as Element;
      const src = el.getAttribute?.('src') || '';
      if (src && !src.startsWith('data:') && !src.startsWith('cid:') && !src.startsWith('file:') && !src.startsWith('cached-image:')) {
        if (blockRemoteImages) {
          // Block this remote image - store the URL before DOMPurify removes it
          blockedUrls.push(src);
          el.setAttribute('data-original-src', src);
          el.removeAttribute('src');
          el.setAttribute('class', (el.getAttribute('class') || '') + ' blocked-image');
        }
        // If not blocking, leave the src attribute as-is (remote load)
      }
    }
  });

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // Set alt text for blocked images
    if (node.tagName === 'IMG' && node.hasAttribute('data-original-src')) {
      node.setAttribute('alt', '[Image blocked]');
    }
    // Defense-in-depth: Sanitize dangerous CSS patterns in style attributes
    // Even though DOMPurify handles most cases, explicitly strip known attack vectors
    if (node.hasAttribute('style')) {
      const style = node.getAttribute('style') || '';
      // Remove: expression(), url(javascript:), behavior:, -moz-binding:
      const sanitized = style
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/url\s*\(\s*["']?\s*javascript:/gi, 'url(blocked:')
        .replace(/behavior\s*:/gi, '')
        .replace(/-moz-binding\s*:/gi, '');
      if (sanitized !== style) {
        node.setAttribute('style', sanitized);
      }
    }
  });

  const sanitized = DOMPurify.sanitize(html, purifyConfig as Parameters<typeof DOMPurify.sanitize>[1]);

  // Clean up hooks after use
  DOMPurify.removeAllHooks();

  return { sanitized, blockedUrls };
}

export function EmailViewer() {
  const {
    selectedEmail: email,
    selectedBody: body,
    // selectedTags removed - using folders (Issue #54)
    selectedAttachments,
    loadingBody,
    toggleStar,
    archive,
    unarchive,
    deleteEmail,
    downloadAttachment,
    filter,
  } = useEmailStore();

  // Determine if viewing Sent folder to show recipients instead of sender
  const isSentFolder = filter.folderPath?.toLowerCase().includes('sent');

  // isArchived check removed - using folders (Issue #54)
  const isArchived = filter.folderPath?.toLowerCase() === 'archive';

  // Tags removed - using folders for organization (Issue #54)
  const { openCompose } = useUIStore();

  // Tag dropdown/feedback state removed - using folders (Issue #54)

  // AI classification state
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationFeedback, setClassificationFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const classificationFeedbackTimeoutRef = useRef<NodeJS.Timeout>();

  // Remote images state
  const [imageSetting, setImageSetting] = useState<'block' | 'allow' | 'auto' | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  // Reclassify modal state (Issue #56)
  const [showReclassifyModal, setShowReclassifyModal] = useState(false);
  const [classificationState, setClassificationState] = useState<{
    emailId: number;
    status: string;
    confidence: number | null;
    priority: string | null;
    suggestedFolder: string | null;
    reasoning: string | null;
    classifiedAt: string | null;
  } | null>(null);

  // Tag dropdown click-outside handler removed (Issue #54)

  // Load classification state when email changes (Issue #56)
  useEffect(() => {
    if (!email) {
      setClassificationState(null);
      return;
    }

    const loadClassificationState = async () => {
      try {
        const state = await window.mailApi.aiSort.getClassificationState(email.id);
        setClassificationState(state);
      } catch (err) {
        console.error('Failed to load classification state:', err);
        setClassificationState(null);
      }
    };

    loadClassificationState();
  }, [email?.id]);

  // Cleanup timeouts on unmount or email change
  useEffect(() => {
    return () => {
      if (classificationFeedbackTimeoutRef.current) {
        clearTimeout(classificationFeedbackTimeoutRef.current);
      }
    };
  }, [email?.id]);

  // Handle opening reclassify modal (Issue #56)
  const handleOpenReclassify = useCallback(() => {
    if (!email) return;
    setShowReclassifyModal(true);
  }, [email]);

  // Handle reclassify confirmation (Issue #56)
  const handleReclassify = useCallback(async () => {
    if (!email) throw new Error('No email selected');
    const result = await window.mailApi.aiSort.reclassify(email.id);
    // Update local classification state
    setClassificationState({
      emailId: email.id,
      status: result.newConfidence >= 0.85 ? 'classified' : 'pending_review',
      confidence: result.newConfidence,
      priority: result.newConfidence >= 0.85 ? 'normal' : 'low',
      suggestedFolder: result.newFolder,
      reasoning: result.reasoning,
      classifiedAt: new Date().toISOString(),
    });
    return result;
  }, [email]);

  // Tag functions removed - using folders (Issue #54)

  // Handle AI classification
  const handleClassify = async () => {
    if (!email || isClassifying) return;
    setIsClassifying(true);
    setClassificationFeedback(null);

    try {
      await window.mailApi.llm.classifyAndApply(email.id);

      // Show success feedback
      setClassificationFeedback({ type: 'success', message: 'Classified!' });

      // Clear any existing timeout
      if (classificationFeedbackTimeoutRef.current) {
        clearTimeout(classificationFeedbackTimeoutRef.current);
      }

      // Auto-hide after 2 seconds
      classificationFeedbackTimeoutRef.current = setTimeout(() => {
        setClassificationFeedback(null);
      }, 2000);
    } catch (error) {
      console.error('Classification failed:', error);

      // Show error feedback
      setClassificationFeedback({ type: 'error', message: 'Classification failed' });

      // Clear any existing timeout
      if (classificationFeedbackTimeoutRef.current) {
        clearTimeout(classificationFeedbackTimeoutRef.current);
      }

      // Auto-hide after 3 seconds
      classificationFeedbackTimeoutRef.current = setTimeout(() => {
        setClassificationFeedback(null);
      }, 3000);
    } finally {
      setIsClassifying(false);
    }
  };

  // Sanitize HTML content and capture blocked URLs
  // NOTE: blockedUrls is derived, not state - this avoids race conditions where
  // effects would run before setState took effect
  const { sanitizedHtml, blockedUrls } = useMemo(() => {
    if (!body?.html) {
      return { sanitizedHtml: null, blockedUrls: [] };
    }
    // Wait for setting to load before sanitizing; default to blocking if unknown
    // When setting is 'allow', don't block images - they'll load directly from remote
    const shouldBlockImages = imageSetting !== 'allow';
    const { sanitized, blockedUrls } = sanitizeEmailHtml(body.html, shouldBlockImages);
    return { sanitizedHtml: sanitized, blockedUrls };
  }, [body?.html, imageSetting]);

  // Load image setting and check if images should be auto-loaded
  useEffect(() => {
    if (!email) {
      setImageSetting(null);
      return;
    }

    const checkAndAutoLoad = async () => {
      try {
        const setting = await window.mailApi.images.getSetting();
        setImageSetting(setting);

        if (setting === 'block') {
          setImagesLoaded(false);
          return;
        }

        if (setting === 'allow') {
          // 'allow' loads directly from remote - no caching, images not blocked
          setImagesLoaded(true);
          return;
        }

        // 'auto' - check if already loaded, otherwise will auto-load
        const loaded = await window.mailApi.images.hasLoaded(email.id);
        setImagesLoaded(loaded);
      } catch (err) {
        console.error('Failed to check images loaded status:', err);
      }
    };

    checkAndAutoLoad();
  }, [email?.id]);

  // Load images when imagesLoaded becomes true and we have blocked URLs
  useEffect(() => {
    if (!email || !imagesLoaded || blockedUrls.length === 0 || !shadowRootRef.current) return;

    const loadImages = async () => {
      try {
        const cached = await window.mailApi.images.load(email.id, blockedUrls);

        // Create a URL mapping
        const urlMap = new Map(cached.map(c => [c.url, c.localPath]));

        // Replace blocked images in the shadow DOM
        const shadowRoot = shadowRootRef.current;
        if (!shadowRoot) return;

        const blockedImages = shadowRoot.querySelectorAll('img[data-original-src]');
        blockedImages.forEach((img) => {
          const originalSrc = img.getAttribute('data-original-src');
          if (originalSrc && urlMap.has(originalSrc)) {
            img.setAttribute('src', urlMap.get(originalSrc)!);
            img.removeAttribute('data-original-src');
            img.setAttribute('alt', '');
            img.classList.remove('blocked-image');
          }
        });
      } catch (err) {
        console.error('Failed to load images:', err);
      }
    };

    loadImages();
  }, [email?.id, imagesLoaded, blockedUrls]);

  // Auto-load images when setting is 'auto' and we have blocked URLs
  useEffect(() => {
    // Only auto-load when setting is 'auto' and images aren't loaded yet
    if (!email || imagesLoaded || blockedUrls.length === 0 || imageSetting !== 'auto') return;

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) return;

      try {
        setLoadingImages(true);
        const cached = await window.mailApi.images.autoLoad(email.id, blockedUrls);

        if (cancelled || !shadowRootRef.current) return;

        // Create URL mapping and update shadow DOM
        const urlMap = new Map(cached.map(c => [c.url, c.localPath]));
        const blockedImages = shadowRootRef.current.querySelectorAll('img[data-original-src]');
        blockedImages.forEach((img) => {
          const originalSrc = img.getAttribute('data-original-src');
          if (originalSrc && urlMap.has(originalSrc)) {
            img.setAttribute('src', urlMap.get(originalSrc)!);
            img.removeAttribute('data-original-src');
            img.setAttribute('alt', '');
            img.classList.remove('blocked-image');
          }
        });

        setImagesLoaded(true);
      } catch (err) {
        console.error('Failed to auto-load images:', err);
      } finally {
        if (!cancelled) setLoadingImages(false);
      }
    }, 200); // 200ms debounce for rapid email switching

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [email?.id, blockedUrls, imagesLoaded, imageSetting]);

  // Handle loading images when user clicks the banner
  const handleLoadImages = useCallback(async () => {
    if (!email || loadingImages) return;

    setLoadingImages(true);
    try {
      setImagesLoaded(true);
    } finally {
      setLoadingImages(false);
    }
  }, [email, loadingImages]);

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

  // getTagClass removed - using folders (Issue #54)

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
            {/* Show Classify for unclassified, Reclassify for already classified (Issue #56) */}
            {classificationState?.suggestedFolder ? (
              <button
                onClick={handleOpenReclassify}
                disabled={isClassifying}
                className="btn btn-icon btn-ghost"
                title="Reclassify with AI"
                style={{ position: 'relative' }}
              >
                <IconSparkles className="w-5 h-5" />
                {/* Small indicator that this is a re-classify action */}
                <span
                  className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                  style={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)' }}
                />
              </button>
            ) : (
              <button
                onClick={handleClassify}
                disabled={isClassifying}
                className="btn btn-icon btn-ghost"
                title={isClassifying ? 'Classifying...' : 'Classify with AI'}
              >
                {isClassifying ? (
                  <IconSpinnerBall className="w-5 h-5 animate-spin" />
                ) : (
                  <IconSparkles className="w-5 h-5" />
                )}
              </button>
            )}
            <button
              onClick={() => isArchived ? unarchive(email.id) : archive(email.id)}
              className="btn btn-icon btn-ghost"
              title={isArchived ? "Restore to Inbox" : "Archive"}
            >
              <IconArchiveBox className="w-5 h-5" style={isArchived ? { transform: 'scaleX(-1)' } : undefined} />
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

        {/* Badges and Feedback */}
        <div className="flex items-center gap-2 mb-4">
          {/* Important badge - based on starred status */}
          {email.isStarred && (
            <span className="badge-important">Important</span>
          )}

          {/* Classification feedback message */}
          {classificationFeedback && (
            <span
              className="text-sm px-2 py-1 rounded-md animate-fade-in flex items-center gap-1.5"
              style={{
                background: classificationFeedback.type === 'success'
                  ? 'var(--color-success-bg)'
                  : 'rgba(239, 68, 68, 0.1)',
                color: classificationFeedback.type === 'success'
                  ? 'var(--color-success-text)'
                  : 'var(--color-danger)',
              }}
            >
              <IconSparkles className="w-3.5 h-3.5" />
              {classificationFeedback.message}
            </span>
          )}
        </div>

        {/* Sender/Recipient Info */}
        <div className="email-viewer-meta">
          <div
            className="email-viewer-avatar"
            style={{ background: email.isStarred ? '#f59e0b' : 'var(--color-accent)' }}
          >
            {isSentFolder && email.to.length > 0
              ? email.to[0][0].toUpperCase()
              : (email.from.name || email.from.address)[0].toUpperCase()}
          </div>
          <div className="flex-1">
            {isSentFolder && email.to.length > 0 ? (
              <>
                <div className="email-viewer-from">
                  <span className="email-viewer-label">To: </span>
                  {email.to.join(', ')}
                </div>
                <div className="email-viewer-date">
                  {formatDate(email.date)}
                </div>
              </>
            ) : (
              <>
                <div className="email-viewer-from">
                  {formatSender(email.from)}
                  <span className="email-viewer-email ml-2">
                    &lt;{email.from.address}&gt;
                  </span>
                </div>
                <div className="email-viewer-date">
                  {formatDate(email.date)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="email-viewer-body">
        {/* Remote Images Banner */}
        {blockedUrls.length > 0 && !imagesLoaded && (
          <div
            className="flex items-center gap-3 px-4 py-3 mb-4 rounded-lg"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            <IconImage className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="flex-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Remote images are hidden to protect your privacy.
            </span>
            <button
              onClick={handleLoadImages}
              disabled={loadingImages}
              className="btn btn-secondary text-sm"
              style={{ padding: '0.375rem 0.75rem' }}
            >
              {loadingImages ? 'Loading...' : 'Load Images'}
            </button>
          </div>
        )}

        <div className="email-viewer-body-content" ref={bodyContainerRef}>
          {sanitizedHtml ? (
            <ShadowContent
              html={sanitizedHtml}
              shadowRootRef={shadowRootRef}
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

      {/* Reclassify Confirmation Modal (Issue #56) */}
      {showReclassifyModal && email && (
        <ReclassifyConfirmModal
          emailId={email.id}
          emailSubject={email.subject || '(no subject)'}
          classification={classificationState}
          onConfirm={handleReclassify}
          onClose={() => setShowReclassifyModal(false)}
        />
      )}
    </div>
  );
}
