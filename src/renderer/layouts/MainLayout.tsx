import { Sidebar } from '../components/Sidebar';
import { EmailList } from '../components/EmailList';
import { EmailViewer } from '../components/EmailViewer';
import { DraftsList } from '../components/DraftsList';
import { TriageReviewView } from '../components/TriageReviewView';
import { AISortView } from '../components/ai-sort';
import { SettingsView } from '../views/SettingsView';

// Match the View type from stores - must be kept in sync
type View = 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'drafts' | 'settings' | 'ai-sort'
  | 'planning' | 'review' | 'feed' | 'social' | 'promotions'
  | 'paper-trail/invoices' | 'paper-trail/admin' | 'paper-trail/travel';

type MainLayoutProps = {
  view: View;
};

/**
 * MainLayout Component
 * Three-panel layout: Sidebar | Content | (optional) Viewer
 */
export function MainLayout({ view }: MainLayoutProps) {
  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      {view === 'settings' ? (
        <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-bg-secondary)' }}>
          <SettingsView />
        </div>
      ) : view === 'drafts' ? (
        <>
          {/* Drafts List - clicking opens ComposeModal */}
          <DraftsList />

          {/* Empty state for viewer when in drafts */}
          <div
            className="flex-1 flex items-center justify-center"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}
          >
            <p>Select a draft to edit</p>
          </div>
        </>
      ) : view === 'review' ? (
        <TriageReviewView />
      ) : view === 'ai-sort' ? (
        <AISortView />
      ) : (
        <>
          {/* Email List */}
          <EmailList />

          {/* Email Viewer */}
          <EmailViewer />
        </>
      )}
    </div>
  );
}
