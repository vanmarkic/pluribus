/**
 * Main App Shell
 *
 * Layout: Sidebar | EmailList | EmailViewer
 * Clean design matching reference.
 */

import { useEffect, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { AccountWizard } from './components/AccountWizard';
import { ComposeModal } from './components/ComposeModal';
import { LicenseActivationModal } from './components/LicenseActivation';
import { SetupWizard } from './components/SetupWizard';
import { useKeyboardShortcuts, KeyboardShortcutsHelp } from './hooks/useKeyboardShortcuts';
import {
  useUIStore,
  useSyncStore,
  useAccountStore,
  useEmailUiStore,
  useLicenseStore,
  useGetEmailQuery,
  useGetEmailBodyQuery,
  invalidateEmailList,
  store,
} from './stores';
import { TitleBar } from './layouts/TitleBar';
import { MainLayout } from './layouts/MainLayout';
import type { SyncProgress } from '../core/domain';

export function App() {
  const { view, showAccountWizard, editAccountId, composeMode, composeEmailId, composeDraftId, closeAccountWizard, closeCompose, openCompose, classificationTaskId, classificationProgress, updateClassificationProgress, clearClassificationTask } = useUIStore();
  const { startSync, truncationInfo, dismissTruncationInfo } = useSyncStore();
  const { loadAccounts, selectedAccountId } = useAccountStore();
  const selectedId = useEmailUiStore((s) => s.selectedId);
  const { data: selectedEmail = null } = useGetEmailQuery(selectedId ?? skipToken);
  const { data: selectedBody } = useGetEmailBodyQuery(selectedId ?? skipToken);
  const { loadState: loadLicenseState } = useLicenseStore();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  // Initial data load
  useEffect(() => {
    loadAccounts();
    loadLicenseState();
  }, []);

  // Check if setup wizard should be shown on first run
  useEffect(() => {
    const checkSetupComplete = async () => {
      try {
        const ollamaConfig = await window.mailApi.config.get('ollama');
        const accounts = await window.mailApi.accounts.list();
        // Show wizard if setup not complete AND no accounts yet (first run)
        if (!ollamaConfig?.setupComplete && accounts.length === 0) {
          setShowSetupWizard(true);
        }
      } catch (err) {
        console.error('Failed to check setup status:', err);
      }
    };
    checkSetupComplete();
  }, []);

  // Email list query auto-fetches when accountId/filter change; no explicit
  // reload needed here.

  // Wire keyboard shortcuts
  useKeyboardShortcuts({
    onCompose: () => openCompose('new'),
    onReply: () => {
      if (selectedEmail) openCompose('reply', selectedEmail.id);
    },
    onReplyAll: () => {
      if (selectedEmail) openCompose('replyAll', selectedEmail.id);
    },
    onForward: () => {
      if (selectedEmail) openCompose('forward', selectedEmail.id);
    },
    onSearch: () => {
      // Search is now handled in TitleBar component
      const searchInput = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]');
      searchInput?.focus();
      searchInput?.select();
    },
    onRefresh: () => {
      if (selectedAccountId) {
        startSync(selectedAccountId).then(() => store.dispatch(invalidateEmailList()));
      }
    },
  });

  // Show shortcuts help on '?'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          setShowShortcutsHelp(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for sync progress
  useEffect(() => {
    const handleProgress = (progress: SyncProgress) => {
      useSyncStore.getState().setProgress(progress);

      // Reload emails when sync completes or is cancelled
      if (progress.phase === 'complete' || progress.phase === 'cancelled') {
        store.dispatch(invalidateEmailList());
      }
    };

    window.mailApi.on('sync:progress', handleProgress);
    return () => window.mailApi.off('sync:progress', handleProgress);
  }, []);

  // Poll classification progress
  useEffect(() => {
    if (!classificationTaskId) return;

    const interval = setInterval(async () => {
      const status = await window.mailApi.llm.getTaskStatus(classificationTaskId);
      if (!status) {
        clearClassificationTask();
        return;
      }

      updateClassificationProgress(status.processed, status.total);

      if (status.status === 'completed' || status.status === 'failed') {
        await window.mailApi.llm.clearTask(classificationTaskId);
        clearClassificationTask();
        // Refresh emails to show new tags
        store.dispatch(invalidateEmailList());
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [classificationTaskId]);

  // Get original email for compose if replying/forwarding
  const composeEmail = composeEmailId ? selectedEmail : undefined;
  const composeBody = composeEmailId ? selectedBody : undefined;

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* macOS Title Bar */}
      <TitleBar classificationProgress={classificationProgress} />

      {/* Main Layout */}
      <MainLayout view={view} />

      {/* Account Wizard Modal */}
      {showAccountWizard && (
        <AccountWizard
          {...(editAccountId != null ? { editAccountId } : {})}
          onClose={closeAccountWizard}
          onSuccess={() => {
            loadAccounts();
            closeAccountWizard();
          }}
        />
      )}

      {/* License Activation Modal */}
      <LicenseActivationModal />

      {/* Compose Modal */}
      {composeMode && (
        <ComposeModal
          mode={composeMode}
          {...(composeEmail ? { originalEmail: composeEmail } : {})}
          {...(composeBody ? { originalBody: composeBody } : {})}
          {...(composeDraftId != null ? { draftId: composeDraftId } : {})}
          onClose={closeCompose}
          onSent={async () => {
            closeCompose();
            // Sync to pull the newly sent email into DB
            // Note: This syncs the default folders (INBOX and Sent) to ensure
            // the sent email appears immediately in the Sent view
            if (selectedAccountId) {
              try {
                await startSync(selectedAccountId);
                store.dispatch(invalidateEmailList());
              } catch (err) {
                console.error('Failed to sync after send:', err);
              }
            }
          }}
        />
      )}

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />

      {/* Setup Wizard */}
      {showSetupWizard && (
        <SetupWizard
          onComplete={async () => {
            await window.mailApi.config.set('ollama', { setupComplete: true });
            setShowSetupWizard(false);
          }}
          onSkip={async () => {
            await window.mailApi.config.set('ollama', { setupComplete: true });
            setShowSetupWizard(false);
          }}
        />
      )}

      {/* Truncation Notification Banner */}
      {truncationInfo && truncationInfo.truncated && (
        <div
          className="fixed bottom-4 left-1/2 transform -translate-x-1/2 max-w-2xl w-auto px-6 py-3 rounded-lg shadow-lg flex items-center gap-3"
          style={{
            background: '#fef3c7',
            color: '#92400e',
            border: '1px solid #fde68a',
            zIndex: 1000
          }}
        >
          <div className="flex-1">
            <div className="font-medium">Mailbox Truncated</div>
            <div className="text-sm">
              Your mailbox has {truncationInfo.totalAvailable.toLocaleString()} emails.
              Showing most recent {truncationInfo.synced.toLocaleString()}.
            </div>
          </div>
          <button
            onClick={dismissTruncationInfo}
            className="px-3 py-1 rounded text-sm font-medium hover:bg-yellow-200/50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
