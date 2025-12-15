/**
 * Email List Component
 *
 * Displays list of emails with sender, subject, snippet, date, and tags.
 * Matches reference design with clean layout.
 */

import { useEffect } from 'react';
import { IconFavorite } from 'obra-icons-react';
import { useEmailStore, useUIStore } from '../stores';
import { formatSender, isRecent } from '../../core/domain';

export function EmailList() {
  const {
    emails,
    selectedId,
    loading,
    loadEmails,
    selectEmail,
    toggleStar,
    getEmailTags,
  } = useEmailStore();
  const { view } = useUIStore();

  useEffect(() => {
    loadEmails();
  }, []);

  // Map view to display title
  const viewTitles: Record<string, string> = {
    inbox: 'Inbox',
    sent: 'Sent',
    starred: 'Starred',
    archive: 'Archive',
    trash: 'Trash',
    'ai-sort': 'AI Sort',
  };
  const title = viewTitles[view] || 'Inbox';

  const formatDate = (date: Date) => {
    const d = new Date(date);
    if (isRecent(d, 24)) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (isRecent(d, 24 * 7)) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Get tag class name for styling
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
    if (slug.includes('shopping')) return 'tag-shopping';
    return 'tag-work'; // default
  };

  return (
    <div className="email-list">
      {/* Header */}
      <div className="email-list-header">
        <h2 className="email-list-title">{title}</h2>
        <span className="email-list-count">{emails.length} messages</span>
      </div>

      {/* Email List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            Loading...
          </div>
        ) : emails.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            No emails
          </div>
        ) : (
          emails.map(email => {
            // Get actual tags for this email from the store
            const emailTags = getEmailTags(email.id).filter(t => !t.isSystem);

            return (
              <div
                key={email.id}
                onClick={() => selectEmail(email.id)}
                className={`email-item ${selectedId === email.id ? 'selected' : ''} ${!email.isRead ? 'unread' : ''}`}
              >
                {/* Header row: Sender + Star + Date */}
                <div className="email-item-header">
                  <div className="flex items-center gap-2">
                    <span className={`email-item-sender ${!email.isRead ? 'unread' : ''}`}>
                      {formatSender(email.from)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStar(email.id);
                      }}
                      className={`star-icon ${email.isStarred ? 'starred' : ''}`}
                    >
                      <IconFavorite className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="email-item-date">{formatDate(email.date)}</span>
                </div>

                {/* Subject */}
                <div className={`email-item-subject ${!email.isRead ? 'unread' : ''}`}>
                  {!email.isRead && <span className="unread-dot mr-2" />}
                  {email.subject || '(no subject)'}
                </div>

                {/* Snippet */}
                <div className="email-item-snippet">
                  {email.snippet}
                </div>

                {/* Tags */}
                {emailTags.length > 0 && (
                  <div className="email-item-tags">
                    {emailTags.map(tag => (
                      <span key={tag.id} className={`tag ${getTagClass(tag.slug)}`}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
