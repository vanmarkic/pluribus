import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useAccountStore } from '../stores';
import { IconSun, IconMoon, IconComputerMonitor } from 'obra-icons-react';
import { SecuritySettings } from '../components/SecuritySettings';
import { TrainingStep } from '../components/onboarding/TrainingStep';
import { AccountSettings } from '../components/settings/AccountSettings';
import { ClassificationSettings } from '../components/settings/ClassificationSettings';

/**
 * Settings View
 * Main settings panel with sections for appearance, accounts, security, and AI classification
 */
export function SettingsView() {
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
