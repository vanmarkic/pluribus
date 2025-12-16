/**
 * Setup Wizard
 *
 * First-run wizard for downloading bundled Ollama binary and a model.
 * Shows on first launch when ollama.setupComplete config is false.
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

type RecommendedModel = {
  id: string;
  name: string;
  description: string;
  size: string;
  sizeBytes: number;
};

type WizardStep = 'welcome' | 'downloading-binary' | 'select-model' | 'downloading-model' | 'complete';

type SetupWizardProps = {
  onComplete: () => void;
  onSkip: () => void;
};

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [models, setModels] = useState<RecommendedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load recommended models
  useEffect(() => {
    window.mailApi.ollama.getRecommendedModels().then(setModels);
  }, []);

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

  // Start binary download
  const handleStartDownload = useCallback(async () => {
    setStep('downloading-binary');
    setError(null);

    try {
      await window.mailApi.ollama.downloadBinary();
      setStep('select-model');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download Ollama');
      setStep('welcome');
    }
  }, []);

  // Download selected model
  const handleDownloadModel = useCallback(async () => {
    if (!selectedModelId) return;

    setStep('downloading-model');
    setError(null);

    try {
      // Start Ollama server first
      await window.mailApi.ollama.start();
      // Pull the model
      await window.mailApi.ollama.pullModel(selectedModelId);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download model');
      setStep('select-model');
    }
  }, [selectedModelId]);

  // Complete setup
  const handleComplete = useCallback(async () => {
    try {
      // Save selected model to config
      const llmConfig = await window.mailApi.config.get('llm');
      await window.mailApi.config.set('llm', {
        ...llmConfig,
        provider: 'ollama',
        model: selectedModelId,
        ollamaServerUrl: 'http://127.0.0.1:11435', // Our bundled Ollama port
      });
      onComplete();
    } catch (err) {
      console.error('Failed to save config:', err);
      onComplete();
    }
  }, [selectedModelId, onComplete]);

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
                Pluribus can classify your emails locally using AI. Your emails never leave your computer.
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
                  <span>AI model (2-4 GB, you choose)</span>
                </li>
              </ul>
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
                onClick={handleStartDownload}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                Download
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
                {progress
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
                  width: `${progress?.percent ?? 0}%`,
                  background: 'var(--color-accent)',
                }}
              />
            </div>

            <p
              className="text-center text-sm"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {progress?.percent ?? 0}% complete
            </p>
          </>
        );

      case 'select-model':
        return (
          <>
            <div className="text-center mb-6">
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Choose a Model
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Select an AI model for email classification
              </p>
            </div>

            <div className="space-y-3 mb-6">
              {models.map((model, index) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModelId(model.id)}
                  className="w-full p-4 rounded-lg text-left transition-all"
                  style={{
                    background:
                      selectedModelId === model.id
                        ? 'var(--color-accent-light, rgba(59, 130, 246, 0.1))'
                        : 'var(--color-bg-secondary)',
                    border: `2px solid ${
                      selectedModelId === model.id
                        ? 'var(--color-accent)'
                        : 'transparent'
                    }`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="font-medium"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {model.name}
                      {index === 0 && (
                        <span
                          className="ml-2 text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: 'var(--color-accent)',
                            color: 'white',
                          }}
                        >
                          Recommended
                        </span>
                      )}
                    </span>
                    <span
                      className="text-sm"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      {model.size}
                    </span>
                  </div>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {model.description}
                  </p>
                </button>
              ))}
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
                onClick={handleDownloadModel}
                disabled={!selectedModelId}
                className="flex-1 py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                style={{
                  background: 'var(--color-accent)',
                  color: 'white',
                }}
              >
                Download Model
                <IconChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        );

      case 'downloading-model':
        const selectedModel = models.find((m) => m.id === selectedModelId);
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
                Downloading {selectedModel?.name ?? 'Model'}
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
              {progress?.phase === 'model' ? `${progress.percent}%` : 'Starting...'} complete
            </p>
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

            <button
              onClick={handleComplete}
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
        {/* Close button - only on welcome and select-model */}
        {(step === 'welcome' || step === 'select-model') && (
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
