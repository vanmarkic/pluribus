/**
 * Main App Shell
 *
 * Layout: Sidebar | EmailList | EmailViewer
 * Clean design matching reference.
 */

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { EmailList } from './components/EmailList';
import { DraftsList } from './components/DraftsList';
import { EmailViewer } from './components/EmailViewer';
import { SecuritySettings } from './components/SecuritySettings';
import { AccountWizard } from './components/AccountWizard';
import { ComposeModal } from './components/ComposeModal';
import { LicenseActivationModal } from './components/LicenseActivation';
import { AISortView } from './components/ai-sort';
import { SetupWizard } from './components/SetupWizard';
import { TriageReviewView } from './components/TriageReviewView';
import { TrainingStep } from './components/onboarding/TrainingStep';
import { useKeyboardShortcuts, KeyboardShortcutsHelp } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
// useTagStore removed - using folders for organization (Issue #54)
import { useUIStore, useSyncStore, useAccountStore, useEmailStore, useLicenseStore } from './stores';
import { IconSun, IconMoon, IconComputerMonitor, IconSearch, IconClose } from 'obra-icons-react';
import { debounce } from './utils/debounce';
import type { SyncProgress } from '../core/domain';

export function App() {
  const { view, showAccountWizard, editAccountId, composeMode, composeEmailId, composeDraftId, closeAccountWizard, closeCompose, openCompose, classificationTaskId, classificationProgress, updateClassificationProgress, clearClassificationTask } = useUIStore();
  const { startSync, truncationInfo, dismissTruncationInfo } = useSyncStore();
  const { loadAccounts, selectedAccountId } = useAccountStore();
  // loadTags removed - using folders (Issue #54)
  const { selectedEmail, selectedBody, loadEmails, search, clearFilter } = useEmailStore();
  const { loadState: loadLicenseState } = useLicenseStore();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

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

  // Initial data load
  useEffect(() => {
    loadAccounts();
    // loadTags removed - using folders (Issue #54)
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

  // Reload emails when selected account changes (clean architecture - component reacts to state)
  useEffect(() => {
    if (selectedAccountId) {
      // Clear search when switching accounts
      setSearchInput('');
      debouncedSearch.cancel();
      loadEmails(selectedAccountId);
    }
  }, [selectedAccountId, loadEmails, debouncedSearch]);

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
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onRefresh: () => {
      if (selectedAccountId) {
        startSync(selectedAccountId).then(() => loadEmails(selectedAccountId));
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
        const accountId = useAccountStore.getState().selectedAccountId;
        if (accountId) {
          useEmailStore.getState().loadEmails(accountId);
        }
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
        if (selectedAccountId) {
          loadEmails(selectedAccountId);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [classificationTaskId]);

  // Get original email for compose if replying/forwarding
  const composeEmail = composeEmailId ? selectedEmail : undefined;
  const composeBody = composeEmailId ? selectedBody : undefined;

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* macOS Title Bar - Drag Region */}
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

      {/* Account Wizard Modal */}
      {showAccountWizard && (
        <AccountWizard
          editAccountId={editAccountId ?? undefined}
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
          originalEmail={composeEmail ?? undefined}
          originalBody={composeBody ?? undefined}
          draftId={composeDraftId ?? undefined}
          onClose={closeCompose}
          onSent={async () => {
            closeCompose();
            // Sync to pull the newly sent email into DB
            // Note: This syncs the default folders (INBOX and Sent) to ensure
            // the sent email appears immediately in the Sent view
            if (selectedAccountId) {
              try {
                await startSync(selectedAccountId);
                // Reload emails to refresh the view
                await loadEmails(selectedAccountId);
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

/**
 * Settings View
 */
function SettingsView() {
  const { theme, setTheme } = useTheme();
  const { selectedAccountId } = useAccountStore();
  const [showTraining, setShowTraining] = useState(false);

  return (
    <>
    {showTraining && selectedAccountId && (
      <TrainingStep
        accountId={selectedAccountId}
        onComplete={() => setShowTraining(false)}
        onSkip={() => setShowTraining(false)}
      />
    )}
    <div className="max-w-2xl mx-auto py-8">
      <h1
        className="text-2xl font-semibold px-6 mb-6"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Settings
      </h1>

      <div className="space-y-6">
        {/* Appearance Section */}
        <section
          className="rounded-lg border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)'
          }}
        >
          <div
            className="px-6 py-4 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Appearance
            </h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  Theme
                </div>
                <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  Choose your preferred color scheme
                </div>
              </div>
              <div
                className="flex items-center gap-1 p-1 rounded-lg"
                style={{ background: 'var(--color-bg-tertiary)' }}
              >
                {[
                  { value: 'light' as const, icon: IconSun, label: 'Light' },
                  { value: 'dark' as const, icon: IconMoon, label: 'Dark' },
                  { value: 'system' as const, icon: IconComputerMonitor, label: 'System' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className="p-2 rounded-md transition-all"
                    style={{
                      background: theme === opt.value ? 'var(--color-bg)' : 'transparent',
                      boxShadow: theme === opt.value ? 'var(--shadow-sm)' : 'none',
                      color: 'var(--color-text-secondary)'
                    }}
                    title={opt.label}
                  >
                    <opt.icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Accounts Section */}
        <section
          className="rounded-lg border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)'
          }}
        >
          <div
            className="px-6 py-4 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Accounts
            </h2>
          </div>
          <div className="p-6">
            <AccountSettings />
          </div>
        </section>

        {/* Security & Privacy Section */}
        <section
          className="rounded-lg border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)'
          }}
        >
          <div
            className="px-6 py-4 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Security & Privacy
            </h2>
          </div>
          <SecuritySettings />
        </section>

        {/* Classification Section */}
        <section
          className="rounded-lg border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)'
          }}
        >
          <div
            className="px-6 py-4 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              AI Classification
            </h2>
          </div>
          <div className="p-6">
            <ClassificationSettings />
          </div>
        </section>

        {/* Triage Training Section */}
        <section
          className="rounded-lg border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)'
          }}
        >
          <div
            className="px-6 py-4 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Triage Training
            </h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  Train the AI
                </div>
                <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  Classify sample emails to improve triage accuracy
                </div>
              </div>
              <button
                onClick={() => setShowTraining(true)}
                disabled={!selectedAccountId}
                className="px-4 py-2 rounded-lg font-medium disabled:opacity-50"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                Start Training
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
    </>
  );
}

/**
 * Account Settings
 */
function AccountSettings() {
  const { accounts, loadAccounts } = useAccountStore();
  const { openAccountWizard } = useUIStore();

  useEffect(() => {
    loadAccounts();
  }, []);

  if (accounts.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
          No accounts configured
        </p>
        <button onClick={() => openAccountWizard()} className="btn btn-primary">
          Add Account
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.map(account => (
        <div
          key={account.id}
          className="flex items-center justify-between p-4 border rounded-lg"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {account.name || account.email}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              {account.email} • {account.isActive ? 'Active' : 'Inactive'}
            </div>
          </div>
          <button
            onClick={() => openAccountWizard(account.id)}
            className="btn btn-ghost text-sm"
          >
            Edit
          </button>
        </div>
      ))}

      <button
        onClick={() => openAccountWizard()}
        className="w-full py-2 text-sm rounded-lg"
        style={{ color: 'var(--color-accent)' }}
      >
        + Add another account
      </button>
    </div>
  );
}

/**
 * Classification Settings
 */
const CONFIDENCE_OPTIONS = [
  { label: 'Low (50%)', value: 0.5 },
  { label: 'Medium (70%)', value: 0.7 },
  { label: 'High (85%)', value: 0.85 },
  { label: 'Very High (95%)', value: 0.95 },
];

const COOLDOWN_OPTIONS = [
  { label: '1 day', value: 1 },
  { label: '3 days', value: 3 },
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
  { label: 'Never (manual only)', value: -1 },
];

function ClassificationSettings() {
  const [config, setConfig] = useState<{
    provider: 'anthropic' | 'ollama';
    model: string;
    dailyBudget: number;
    dailyEmailLimit: number;
    autoClassify: boolean;
    confidenceThreshold?: number;
    reclassifyCooldownDays?: number;
    ollamaServerUrl?: string;
  } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [emailBudget, setEmailBudget] = useState<{ used: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // New state for provider features
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [validatingKey, setValidatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  // Track initial provider and model to detect changes requiring restart
  const [initialProvider, setInitialProvider] = useState<string | null>(null);
  const [initialModel, setInitialModel] = useState<string | null>(null);
  const [llmConfigChanged, setLlmConfigChanged] = useState(false);

  // Cache models per provider to avoid refetching on every settings load
  const modelCache = useRef<Record<string, { id: string; displayName: string }[]>>({});

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [llmConfig, apiKeyStatus, budget] = await Promise.all([
          window.mailApi.config.get('llm'),
          window.mailApi.credentials.hasApiKey('anthropic'),
          window.mailApi.llm.getEmailBudget()
        ]);
        setConfig(llmConfig as typeof config);
        setHasApiKey(apiKeyStatus);
        setEmailBudget(budget);
        // Capture initial provider and model on first load
        if (initialProvider === null && llmConfig) {
          const cfg = llmConfig as typeof config;
          setInitialProvider(cfg?.provider ?? null);
          setInitialModel(cfg?.model ?? null);
        }
      } catch (error) {
        console.error('Failed to load classification settings:', error);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  // Load models when provider changes or API key is set
  useEffect(() => {
    if (!config) return;

    const loadModels = async () => {
      // For Anthropic, only load if API key is configured
      if (config.provider === 'anthropic' && !hasApiKey) {
        setModels([]);
        return;
      }

      // For Ollama, check connection first
      if (config.provider === 'ollama') {
        setTestingConnection(true);
        const status = await window.mailApi.llm.testConnection();
        setOllamaStatus(status);
        setTestingConnection(false);
        if (!status.connected) {
          setModels([]);
          return;
        }
      }

      // Check cache first
      const cacheKey = config.provider;
      if (modelCache.current[cacheKey]?.length > 0) {
        setModels(modelCache.current[cacheKey]);
        return;
      }

      setLoadingModels(true);
      try {
        const modelList = await window.mailApi.llm.listModels();
        // Store in cache
        modelCache.current[cacheKey] = modelList;
        setModels(modelList);

        // Auto-select first model if current model is empty or not in list
        if (modelList.length > 0) {
          const currentModelValid = modelList.some(m => m.id === config.model);
          if (!currentModelValid) {
            updateConfig({ model: modelList[0].id });
          }
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        setModels([]);
      } finally {
        setLoadingModels(false);
      }
    };

    loadModels();
  }, [config?.provider, hasApiKey]);

  // Save config changes
  const updateConfig = async (updates: Partial<NonNullable<typeof config>>) => {
    if (!config) return;
    const newConfig = { ...config, ...updates };
    try {
      await window.mailApi.config.set('llm', newConfig);
      setConfig(newConfig);
      // Check if provider or model changed from initial
      const providerChanged = updates.provider && updates.provider !== initialProvider;
      const modelChanged = updates.model && updates.model !== initialModel;
      if (providerChanged || modelChanged) {
        setLlmConfigChanged(true);
      }
    } catch (error) {
      console.error('Failed to save classification settings:', error);
    }
  };

  // Validate and save API key
  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    setValidatingKey(true);
    setKeyError(null);

    try {
      const result = await window.mailApi.llm.validate(apiKeyInput);
      if (result.valid) {
        await window.mailApi.credentials.setApiKey('anthropic', apiKeyInput);
        setHasApiKey(true);
        setApiKeyInput('');
        // Clear cache and reload models after key is saved
        delete modelCache.current['anthropic'];
        const modelList = await window.mailApi.llm.listModels();
        modelCache.current['anthropic'] = modelList;
        setModels(modelList);

        // Auto-select first model if current model is empty or not in list
        if (modelList.length > 0 && config) {
          const currentModelValid = modelList.some(m => m.id === config.model);
          if (!currentModelValid) {
            updateConfig({ model: modelList[0].id });
          }
        }
      } else {
        setKeyError(result.error || 'Invalid API key');
      }
    } catch (error) {
      setKeyError(String(error));
    } finally {
      setValidatingKey(false);
    }
  };

  // Test Ollama connection
  const handleTestOllama = async () => {
    setTestingConnection(true);
    try {
      const status = await window.mailApi.llm.testConnection();
      setOllamaStatus(status);
      if (status.connected) {
        // Clear cache and reload models
        delete modelCache.current['ollama'];
        const modelList = await window.mailApi.llm.listModels();
        modelCache.current['ollama'] = modelList;
        setModels(modelList);

        // Auto-select first model if current model is empty or not in list
        if (modelList.length > 0 && config) {
          const currentModelValid = modelList.some(m => m.id === config.model);
          if (!currentModelValid) {
            updateConfig({ model: modelList[0].id });
          }
        }
      }
    } finally {
      setTestingConnection(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto-classify toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Auto-classify new emails
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Use AI to automatically tag incoming emails
          </div>
        </div>
        <input
          type="checkbox"
          checked={config.autoClassify}
          onChange={(e) => updateConfig({ autoClassify: e.target.checked })}
          className="h-5 w-5"
        />
      </div>

      {/* Provider selection */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Provider
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              Choose between cloud or local LLM
            </div>
          </div>
          <select
            value={config.provider}
            onChange={(e) => updateConfig({ provider: e.target.value as 'anthropic' | 'ollama', model: '' })}
            className="input w-48"
          >
            <option value="anthropic">Anthropic Claude</option>
            <option value="ollama">Local (Ollama)</option>
          </select>
        </div>
        {llmConfigChanged && (
          <div
            className="mt-2 p-2 rounded text-sm"
            style={{
              background: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a'
            }}
          >
            Restart the app for provider/model change to take effect
          </div>
        )}
      </div>

      {/* Anthropic API Key */}
      {config.provider === 'anthropic' && (
        <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
            API Key
          </div>
          {hasApiKey ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: 'var(--color-success)' }}
                />
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  sk-ant-••••••••••••
                </span>
              </div>
              <button
                onClick={() => setHasApiKey(false)}
                className="text-sm px-3 py-1 rounded"
                style={{ color: 'var(--color-primary)', background: 'var(--color-bg-secondary)' }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  className="input flex-1"
                />
                <button
                  onClick={handleSaveApiKey}
                  disabled={validatingKey || !apiKeyInput.trim()}
                  className="btn btn-primary"
                >
                  {validatingKey ? 'Validating...' : 'Save'}
                </button>
              </div>
              {keyError && (
                <div className="text-sm" style={{ color: 'var(--color-danger)' }}>
                  {keyError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ollama Server URL */}
      {config.provider === 'ollama' && (
        <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Server URL
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.ollamaServerUrl || 'http://localhost:11434'}
              onChange={(e) => updateConfig({ ollamaServerUrl: e.target.value })}
              className="input flex-1"
            />
            <button
              onClick={handleTestOllama}
              disabled={testingConnection}
              className="btn"
              style={{ background: 'var(--color-bg-secondary)' }}
            >
              {testingConnection ? 'Testing...' : 'Test'}
            </button>
          </div>
          {ollamaStatus && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: ollamaStatus.connected ? 'var(--color-success)' : 'var(--color-danger)' }}
                />
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {ollamaStatus.connected ? 'Connected' : ollamaStatus.error || 'Not connected'}
                </span>
              </div>
              {!ollamaStatus.connected && (
                <button
                  onClick={async () => {
                    setTestingConnection(true);
                    const result = await window.mailApi.llm.startOllama();
                    if (result.started) {
                      // Refresh connection status and models
                      const status = await window.mailApi.llm.testConnection();
                      setOllamaStatus(status);
                      if (status.connected) {
                        delete modelCache.current['ollama'];
                        const modelList = await window.mailApi.llm.listModels();
                        setModels(modelList);
                      }
                    } else {
                      setOllamaStatus({ connected: false, error: result.error });
                    }
                    setTestingConnection(false);
                  }}
                  disabled={testingConnection}
                  className="btn mt-2"
                  style={{ background: '#2563eb', color: 'white', border: 'none' }}
                >
                  {testingConnection ? 'Starting...' : 'Start Ollama'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Model selection */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Model
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {config.provider === 'anthropic' ? 'Choose speed vs quality' : 'Select installed model'}
          </div>
        </div>
        <select
          value={config.model}
          onChange={(e) => updateConfig({ model: e.target.value })}
          className="input w-48"
          disabled={loadingModels || models.length === 0}
        >
          {loadingModels ? (
            <option>Loading...</option>
          ) : models.length === 0 ? (
            <option>{config.provider === 'anthropic' ? 'Configure API key first' : 'No models found'}</option>
          ) : (
            models.map(m => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))
          )}
        </select>
      </div>

      {/* Daily token budget */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Daily token budget
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Limit API usage to control costs
          </div>
        </div>
        <input
          type="number"
          value={config.dailyBudget}
          onChange={(e) => updateConfig({ dailyBudget: parseInt(e.target.value) || 0 })}
          min="1000"
          step="1000"
          className="input w-32"
        />
      </div>

      {/* Daily email limit */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Daily email limit
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Maximum emails to classify per day
          </div>
        </div>
        <input
          type="number"
          value={config.dailyEmailLimit}
          onChange={(e) => updateConfig({ dailyEmailLimit: parseInt(e.target.value) || 0 })}
          min="1"
          step="10"
          className="input w-32"
        />
      </div>

      {/* Confidence threshold */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Confidence threshold
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Minimum confidence to auto-apply tags
          </div>
        </div>
        <select
          value={config.confidenceThreshold ?? 0.7}
          onChange={(e) => updateConfig({ confidenceThreshold: parseFloat(e.target.value) })}
          className="input w-40"
        >
          {CONFIDENCE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Reclassify cooldown */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Reclassify cooldown
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Wait time before reclassifying edited emails
          </div>
        </div>
        <select
          value={config.reclassifyCooldownDays ?? 7}
          onChange={(e) => updateConfig({ reclassifyCooldownDays: parseInt(e.target.value) })}
          className="input w-48"
        >
          {COOLDOWN_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Usage section */}
      <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        {emailBudget && (
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              Daily usage
            </div>
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {emailBudget.used} / {emailBudget.limit} emails classified today
            </span>
          </div>
        )}
        {config.provider === 'anthropic' && (
          <a
            href="https://console.anthropic.com/settings/usage"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm flex items-center gap-1"
            style={{ color: 'var(--color-primary)' }}
          >
            View usage in Anthropic Console
            <span>→</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default App;
