/**
 * Setup Wizard
 *
 * First-run wizard for downloading bundled Ollama binary and required models.
 * Shows when Ollama is not installed.
 *
 * Downloads:
 * - Ollama runtime (~50 MB)
 * - Mistral 7B (for email classification)
 * - Qwen 2.5:1.5b (for awaiting reply detection)
 */

import { useState, useEffect, useCallback } from 'react';
import { IconCheck, IconClose, IconChevronRight } from 'obra-icons-react';

// Progress type from OllamaManager
type DownloadProgress = {
  phase: 'binary' | 'model';
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  modelName?: string;
};

// Models to install automatically
const REQUIRED_MODELS = [
  { id: 'mistral:7b', name: 'Mistral 7B', size: '4.1 GB' },
  { id: 'qwen2.5:1.5b', name: 'Qwen 2.5', size: '1.0 GB' },
];

type WizardStep = 'welcome' | 'downloading-binary' | 'downloading-models' | 'complete';

type SetupWizardProps = {
  onComplete: () => void;
  onSkip: () => void;
};

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [currentModelIndex, setCurrentModelIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Listen for download progress
  useEffect(() => {
    const handleProgress = (data: DownloadProgress) => {
      setProgress(data);
    };

    window.mailApi.on('ollama:download-progress', handleProgress);
    return () => window.mailApi.off('ollama:download-progress', handleProgress);
  }, []);

  // Format bytes to human-readable
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Start the full installation process
  const handleStartInstall = useCallback(async () => {
    setStep('downloading-binary');
    setError(null);

    try {
      // Step 1: Download Ollama binary
      await window.mailApi.ollama.downloadBinary();

      // Step 2: Start Ollama server
      await window.mailApi.ollama.start();

      // Step 3: Download required models
      setStep('downloading-models');
      for (let i = 0; i < REQUIRED_MODELS.length; i++) {
        setCurrentModelIndex(i);
        await window.mailApi.ollama.pullModel(REQUIRED_MODELS[i].id);
      }

      // Step 4: Save config with first model as default
      const llmConfig = await window.mailApi.config.get('llm');
      await window.mailApi.config.set('llm', {
        ...llmConfig,
        provider: 'ollama',
        model: REQUIRED_MODELS[0].id, // mistral:7b as default for classification
        ollamaServerUrl: 'http://127.0.0.1:11435',
      });

      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
      setStep('welcome');
    }
  }, []);

  // Render content based on step
  const renderContent = () => {
    switch (step) {
      case 'welcome':
        return (
          <>
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--color-accent)', color: 'white' }}
              >
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Set Up Local AI
              </h1>
              <p
                className="text-base max-w-md mx-auto"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Pluribus uses AI to classify your emails locally. Your data never leaves your computer.
              </p>
            </div>

            <div
              className="rounded-lg p-4 mb-6"
              style={{ background: 'var(--color-bg-secondary)' }}
            >
              <h3
                className="font-medium mb-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                What will be downloaded:
              </h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <li className="flex items-center gap-2">
                  <IconCheck className="w-4 h-4 text-green-500" />
                  <span>Ollama runtime (~50 MB)</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="w-4 h-4 text-green-500" />
                  <span>Mistral 7B - email classification (4.1 GB)</span>
                </li>
                <li className="flex items-center gap-2">
                  <IconCheck className="w-4 h-4 text-green-500" />
                  <span>Qwen 2.5 - fast analysis (1.0 GB)</span>
                </li>
              </ul>
              <p className="mt-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Total: ~5.2 GB. This may take a few minutes.
              </p>
            </div>

            {error && (
              <div
                className="rounded-lg p-3 mb-4 text-sm"
                style={{
                  background: '#fef2f2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                }}
              >
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onSkip}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                Skip for Now
              </button>
              <button
                onClick={handleStartInstall}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                Install
                <IconChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        );

      case 'downloading-binary':
        return (
          <>
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center animate-pulse"
                style={{ background: 'var(--color-accent-light, var(--color-bg-secondary))' }}
              >
                <div
                  className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin"
                  style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
                />
              </div>
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Downloading Ollama
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                {progress?.phase === 'binary' && progress.totalBytes > 0
                  ? `${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`
                  : 'Starting download...'}
              </p>
            </div>

            {/* Progress bar */}
            <div
              className="h-2 rounded-full overflow-hidden mb-4"
              style={{ background: 'var(--color-bg-secondary)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress?.phase === 'binary' ? progress.percent : 0}%`,
                  background: 'var(--color-accent)',
                }}
              />
            </div>

            <p
              className="text-center text-sm"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Step 1 of 3: {progress?.phase === 'binary' ? `${progress.percent}%` : '0%'} complete
            </p>
          </>
        );

      case 'downloading-models':
        const currentModel = REQUIRED_MODELS[currentModelIndex];
        return (
          <>
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center animate-pulse"
                style={{ background: 'var(--color-accent-light, var(--color-bg-secondary))' }}
              >
                <div
                  className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin"
                  style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
                />
              </div>
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Downloading {currentModel?.name ?? 'Model'}
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                {progress?.phase === 'model' && progress.totalBytes > 0
                  ? `${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`
                  : 'Preparing download...'}
              </p>
            </div>

            {/* Progress bar */}
            <div
              className="h-2 rounded-full overflow-hidden mb-4"
              style={{ background: 'var(--color-bg-secondary)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress?.phase === 'model' ? progress.percent : 0}%`,
                  background: 'var(--color-accent)',
                }}
              />
            </div>

            <p
              className="text-center text-sm"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Step {currentModelIndex + 2} of 3: {progress?.phase === 'model' ? `${progress.percent}%` : 'Starting...'} complete
            </p>

            {/* Model progress indicators */}
            <div className="flex justify-center gap-2 mt-4">
              {REQUIRED_MODELS.map((model, index) => (
                <div
                  key={model.id}
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: index < currentModelIndex
                      ? 'var(--color-accent)'
                      : index === currentModelIndex
                        ? 'var(--color-accent-light, var(--color-bg-secondary))'
                        : 'var(--color-bg-secondary)',
                  }}
                />
              ))}
            </div>
          </>
        );

      case 'complete':
        return (
          <>
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                style={{ background: '#dcfce7' }}
              >
                <IconCheck className="w-8 h-8 text-green-600" />
              </div>
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                All Set!
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Local AI is ready. Your emails will be classified privately on your device.
              </p>
            </div>

            <div
              className="rounded-lg p-4 mb-6"
              style={{ background: 'var(--color-bg-secondary)' }}
            >
              <h3
                className="font-medium mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Installed:
              </h3>
              <ul className="space-y-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {REQUIRED_MODELS.map((model) => (
                  <li key={model.id} className="flex items-center gap-2">
                    <IconCheck className="w-4 h-4 text-green-500" />
                    <span>{model.name}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={onComplete}
              className="w-full py-2.5 px-4 rounded-lg font-medium"
              style={{
                background: 'var(--color-accent)',
                color: 'white',
              }}
            >
              Get Started
            </button>
          </>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl p-8"
        style={{ background: 'var(--color-bg)' }}
      >
        {/* Close button - only on welcome */}
        {step === 'welcome' && (
          <button
            onClick={onSkip}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
            title="Skip setup"
          >
            <IconClose
              className="w-5 h-5"
              style={{ color: 'var(--color-text-tertiary)' }}
            />
          </button>
        )}

        {renderContent()}
      </div>
    </div>
  );
}
