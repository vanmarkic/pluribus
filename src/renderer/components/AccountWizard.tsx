/**
 * Account Setup Wizard
 * 
 * Add/edit email accounts with connection testing.
 */

import { useState, useEffect } from 'react';
import { IconClose, IconSpinnerBall, IconCircleCheckFill, IconCircleWarningFill, IconEmail, IconDownload } from 'obra-icons-react';
import type { SyncProgress } from '../../core/domain';

type Provider = 'gmail' | 'outlook' | 'icloud' | 'infomaniak' | 'fastmail' | 'other';

type AccountFormData = {
  email: string;
  password: string;
  provider: Provider;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

const PROVIDER_PRESETS: Record<Provider, Pick<AccountFormData, 'imapHost' | 'imapPort' | 'smtpHost' | 'smtpPort'>> = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  outlook: { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  icloud: { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587 },
  infomaniak: { imapHost: 'mail.infomaniak.com', imapPort: 993, smtpHost: 'mail.infomaniak.com', smtpPort: 465 },
  fastmail: { imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 465 },
  other: { imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465 },
};

type Props = {
  editAccountId?: number;
  onClose: () => void;
  onSuccess: () => void;
};

export function AccountWizard({ editAccountId, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'provider' | 'credentials' | 'test' | 'syncing' | 'complete'>('provider');
  const [form, setForm] = useState<AccountFormData>({
    email: '',
    password: '',
    provider: 'other',
    ...PROVIDER_PRESETS.other,
  });

  // Load existing account if editing
  useEffect(() => {
    if (editAccountId) {
      window.mailApi.accounts.get(editAccountId).then(account => {
        if (account) {
          setForm(prev => ({
            ...prev,
            email: account.email,
            imapHost: account.imapHost,
            imapPort: account.imapPort,
            smtpHost: account.smtpHost,
            smtpPort: account.smtpPort,
          }));
          setStep('credentials');
        }
      });
    }
  }, [editAccountId]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncResult, setSyncResult] = useState<{ newCount: number; maxMessagesPerFolder: number } | null>(null);

  const handleProviderSelect = (provider: Provider) => {
    setForm(prev => ({
      ...prev,
      provider,
      ...PROVIDER_PRESETS[provider],
    }));
    setStep('credentials');
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      // Store password first so IMAP/SMTP adapters can access it
      await window.mailApi.credentials.setPassword(form.email, form.password);

      // Test both IMAP and SMTP connections
      const [imapResult, smtpResult] = await Promise.all([
        window.mailApi.accounts.testImap(form.email, form.imapHost, form.imapPort),
        window.mailApi.accounts.testSmtp(form.email, form.smtpHost, form.smtpPort),
      ]);

      if (imapResult?.ok && smtpResult?.ok) {
        setTestResult('success');
      } else {
        setTestResult('error');
        const errors = [];
        if (!imapResult?.ok) errors.push(imapResult?.error || 'IMAP connection failed');
        if (!smtpResult?.ok) errors.push(smtpResult?.error || 'SMTP connection failed');
        setError(errors.join('. '));
      }
    } catch (err) {
      setTestResult('error');
      setError(String(err));
    } finally {
      setTesting(false);
    }
  };

  // Subscribe to sync progress events
  useEffect(() => {
    const handleProgress = (progress: SyncProgress) => {
      if (step === 'syncing') {
        setSyncProgress(progress);
      }
    };
    window.mailApi.on('sync:progress', handleProgress);
    return () => window.mailApi.off('sync:progress', handleProgress);
  }, [step]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editAccountId) {
        // Editing existing account - just update, no sync
        await window.mailApi.accounts.update(editAccountId, {
          name: form.email.split('@')[0],
          imapHost: form.imapHost,
          imapPort: form.imapPort,
          smtpHost: form.smtpHost,
          smtpPort: form.smtpPort,
        }, form.password || undefined);
        onSuccess();
      } else {
        // New account - use addAccount which creates + syncs
        setStep('syncing');
        setSaving(false);

        const result = await window.mailApi.accounts.add({
          name: form.email.split('@')[0],
          email: form.email,
          imapHost: form.imapHost,
          imapPort: form.imapPort,
          smtpHost: form.smtpHost,
          smtpPort: form.smtpPort,
          username: form.email,
        }, form.password);

        setSyncResult({
          newCount: result.syncResult.newCount,
          maxMessagesPerFolder: result.maxMessagesPerFolder,
        });
        setStep('complete');
      }
    } catch (err) {
      setError(String(err));
      if (step === 'syncing') {
        setStep('test');
        setTestResult('success'); // Connection was successful, sync failed
      }
      setSaving(false);
    }
  };

  const providers: { id: Provider; name: string; icon: string }[] = [
    { id: 'gmail', name: 'Gmail', icon: '📧' },
    { id: 'outlook', name: 'Outlook', icon: '📬' },
    { id: 'icloud', name: 'iCloud', icon: '☁️' },
    { id: 'infomaniak', name: 'Infomaniak', icon: '🇨🇭' },
    { id: 'fastmail', name: 'Fastmail', icon: '⚡' },
    { id: 'other', name: 'Other IMAP', icon: '⚙️' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">
            {editAccountId ? 'Edit Account' : 'Add Account'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded">
            <IconClose className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'provider' && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-600 mb-4">Choose your email provider:</p>
              <div className="grid grid-cols-2 gap-3">
                {providers.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderSelect(p.id)}
                    className="flex items-center gap-3 p-4 border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                  >
                    <span className="text-2xl">{p.icon}</span>
                    <span className="font-medium">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'credentials' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="you@example.com"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">
                  Password
                  {form.provider === 'gmail' && (
                    <span className="text-xs text-zinc-500 ml-2">(App Password required)</span>
                  )}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                />
              </div>

              {form.provider === 'other' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">IMAP Host</label>
                      <input
                        type="text"
                        value={form.imapHost}
                        onChange={e => setForm(prev => ({ ...prev, imapHost: e.target.value }))}
                        className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                        placeholder="imap.example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">IMAP Port</label>
                      <input
                        type="number"
                        value={form.imapPort}
                        onChange={e => setForm(prev => ({ ...prev, imapPort: Number(e.target.value) }))}
                        className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP Host</label>
                      <input
                        type="text"
                        value={form.smtpHost}
                        onChange={e => setForm(prev => ({ ...prev, smtpHost: e.target.value }))}
                        className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP Port</label>
                      <input
                        type="number"
                        value={form.smtpPort}
                        onChange={e => setForm(prev => ({ ...prev, smtpPort: Number(e.target.value) }))}
                        className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <IconCircleWarningFill className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep('provider')}
                  className="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('test')}
                  disabled={!form.email || !form.password}
                  className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 'test' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                {!testing && !testResult && (
                  <>
                    <IconEmail className="w-12 h-12 mx-auto text-zinc-300 mb-3" />
                    <p className="text-zinc-600">Ready to test connection</p>
                  </>
                )}

                {testing && (
                  <>
                    <IconSpinnerBall className="w-12 h-12 mx-auto text-blue-600 animate-spin mb-3" />
                    <p className="text-zinc-600">Testing connection...</p>
                  </>
                )}

                {testResult === 'success' && (
                  <>
                    <IconCircleCheckFill className="w-12 h-12 mx-auto text-green-600 mb-3" />
                    <p className="text-green-600 font-medium">Connection successful!</p>
                  </>
                )}

                {testResult === 'error' && (
                  <>
                    <IconCircleWarningFill className="w-12 h-12 mx-auto text-red-600 mb-3" />
                    <p className="text-red-600 font-medium">Connection failed</p>
                    {error && <p className="text-sm text-zinc-500 mt-1">{error}</p>}
                  </>
                )}
              </div>

              {/* Show errors from save operation */}
              {testResult === 'success' && error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                  <IconCircleWarningFill className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('credentials')}
                  className="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
                >
                  Back
                </button>
                
                {!testResult && (
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Test Connection
                  </button>
                )}
                
                {testResult === 'error' && (
                  <button
                    onClick={handleTest}
                    className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Retry
                  </button>
                )}
                
                {testResult === 'success' && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Account'}
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'syncing' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <IconDownload className="w-12 h-12 mx-auto text-blue-600 animate-pulse mb-3" />
                <p className="text-zinc-800 font-medium">Downloading emails...</p>
                {syncProgress && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-zinc-600">
                      {syncProgress.folder}: {syncProgress.current} of {syncProgress.total}
                    </p>
                    <div className="w-full bg-zinc-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-zinc-500">
                      {syncProgress.newCount} new emails found
                    </p>
                  </div>
                )}
                <p className="text-xs text-zinc-400 mt-4">
                  Downloading up to 1,000 most recent emails per folder
                </p>
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <IconCircleCheckFill className="w-12 h-12 mx-auto text-green-600 mb-3" />
                <p className="text-green-600 font-medium">Account added successfully!</p>
                {syncResult && (
                  <div className="mt-3 space-y-1">
                    <p className="text-sm text-zinc-600">
                      {syncResult.newCount.toLocaleString()} emails downloaded
                    </p>
                    <p className="text-xs text-zinc-400">
                      Only the {syncResult.maxMessagesPerFolder.toLocaleString()} most recent emails per folder were downloaded
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={onSuccess}
                className="w-full px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
