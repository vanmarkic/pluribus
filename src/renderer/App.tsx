/**
 * Main App Shell
 *
 * Layout: Sidebar | EmailList | EmailViewer
 * Clean design matching reference.
 */

import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { EmailList } from './components/EmailList';
import { EmailViewer } from './components/EmailViewer';
import { SecuritySettings } from './components/SecuritySettings';
import { AccountWizard } from './components/AccountWizard';
import { ComposeModal } from './components/ComposeModal';
import { useKeyboardShortcuts, KeyboardShortcutsHelp } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useUIStore, useSyncStore, useAccountStore, useTagStore, useEmailStore } from './stores';
import { IconSun, IconMoon, IconComputerMonitor } from 'obra-icons-react';

export function App() {
  const { view, showAccountWizard, editAccountId, composeMode, composeEmailId, closeAccountWizard, closeCompose, openCompose } = useUIStore();
  const { setProgress, startSync } = useSyncStore();
  const { loadAccounts } = useAccountStore();
  const { loadTags } = useTagStore();
  const { selectedEmail, selectedBody } = useEmailStore();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Initial data load
  useEffect(() => {
    loadAccounts();
    loadTags();
  }, []);

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
      // TODO: Focus search input
    },
    onRefresh: () => {
      startSync();
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

  // Subscribe to sync progress events
  useEffect(() => {
    const handleProgress = (progress: unknown) => {
      setProgress(progress as Parameters<typeof setProgress>[0]);
    };

    window.mailApi.on('sync:progress', handleProgress);

    return () => {
      window.mailApi.off('sync:progress', handleProgress);
    };
  }, []);

  // Get original email for compose if replying/forwarding
  const composeEmail = composeEmailId ? selectedEmail : undefined;
  const composeBody = composeEmailId ? selectedBody : undefined;

  return (
    <div className="flex h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      {view === 'settings' ? (
        <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-bg-secondary)' }}>
          <SettingsView />
        </div>
      ) : (
        <>
          {/* Email List */}
          <EmailList />

          {/* Email Viewer */}
          <EmailViewer />
        </>
      )}

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

      {/* Compose Modal */}
      {composeMode && (
        <ComposeModal
          mode={composeMode}
          originalEmail={composeEmail ?? undefined}
          originalBody={composeBody ?? undefined}
          onClose={closeCompose}
          onSent={() => {
            closeCompose();
          }}
        />
      )}

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />
    </div>
  );
}

/**
 * Settings View
 */
function SettingsView() {
  const { theme, setTheme } = useTheme();

  return (
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

        {/* Security Section */}
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
              Security
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
      </div>
    </div>
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
function ClassificationSettings() {
  const [config, setConfig] = useState<{
    model: 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514';
    dailyBudget: number;
    dailyEmailLimit: number;
    autoClassify: boolean;
  } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [llmConfig, apiKeyStatus] = await Promise.all([
          window.mailApi.config.get('llm'),
          window.mailApi.credentials.hasApiKey('anthropic')
        ]);
        setConfig(llmConfig as typeof config);
        setHasApiKey(apiKeyStatus);
      } catch (error) {
        console.error('Failed to load classification settings:', error);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  // Save config changes
  const updateConfig = async (updates: Partial<NonNullable<typeof config>>) => {
    if (!config) return;
    const newConfig = { ...config, ...updates };
    try {
      await window.mailApi.config.set('llm', newConfig);
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save classification settings:', error);
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

      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Model
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Choose between speed (Haiku) or quality (Sonnet)
          </div>
        </div>
        <select
          value={config.model}
          onChange={(e) => updateConfig({ model: e.target.value as typeof config.model })}
          className="input w-48"
        >
          <option value="claude-haiku-4-20250514">Claude Haiku 4</option>
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
        </select>
      </div>

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

      <div
        className="pt-4 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="text-sm mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
          API Key Status
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: hasApiKey ? 'var(--color-success)' : 'var(--color-danger)' }}
          />
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {hasApiKey ? 'Configured' : 'Not configured'}
          </span>
        </div>
        {!hasApiKey && (
          <div className="text-sm mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Set your Anthropic API key in the terminal to enable AI classification
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
