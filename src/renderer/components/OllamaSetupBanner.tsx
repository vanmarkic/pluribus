/**
 * Ollama Setup Banner
 *
 * Non-blocking banner showing Ollama setup progress.
 * Appears at top of screen during background download.
 */

import { useOllamaSetupStore } from '../stores';

export function OllamaSetupBanner() {
  const { phase, progress, currentModel, modelsCompleted, modelsTotal, error, skipSetup, startSetup } = useOllamaSetupStore();

  // Don't show banner if ready, skipped, or idle
  if (phase === 'ready' || phase === 'skipped' || phase === 'idle' || phase === 'checking') {
    return null;
  }

  // Error state
  if (phase === 'error') {
    return (
      <div
        className="fixed top-12 left-1/2 transform -translate-x-1/2 max-w-lg w-full mx-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50"
        style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
        }}
      >
        <div className="flex-1">
          <div className="font-medium text-red-800">AI Setup Failed</div>
          <div className="text-sm text-red-600">{error}</div>
        </div>
        <button
          onClick={() => startSetup()}
          className="px-3 py-1 rounded text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
        >
          Retry
        </button>
        <button
          onClick={skipSetup}
          className="px-3 py-1 rounded text-sm font-medium text-red-600 hover:bg-red-100 transition-colors"
        >
          Skip
        </button>
      </div>
    );
  }

  // Progress message based on phase
  const getMessage = () => {
    switch (phase) {
      case 'downloading-binary':
        return `Downloading Ollama... ${progress}%`;
      case 'starting':
        return 'Starting Ollama server...';
      case 'downloading-models':
        return `Downloading ${currentModel || 'model'} (${modelsCompleted + 1}/${modelsTotal})... ${progress}%`;
      default:
        return 'Setting up AI...';
    }
  };

  // Calculate overall progress (binary = 0-33%, models = 33-100%)
  const getOverallProgress = () => {
    if (phase === 'downloading-binary') {
      return Math.round(progress * 0.2); // 0-20%
    }
    if (phase === 'starting') {
      return 20; // 20%
    }
    if (phase === 'downloading-models') {
      const modelProgress = (modelsCompleted + progress / 100) / modelsTotal;
      return Math.round(20 + modelProgress * 80); // 20-100%
    }
    return 0;
  };

  return (
    <div
      className="fixed top-12 left-1/2 transform -translate-x-1/2 max-w-lg w-full mx-4 px-4 py-3 rounded-lg shadow-lg z-50"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-3 mb-2">
        {/* Spinner */}
        <div
          className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0"
          style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
        />
        <div className="flex-1">
          <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Setting up Local AI
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {getMessage()}
          </div>
        </div>
        <button
          onClick={skipSetup}
          className="text-xs px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Skip
        </button>
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-bg-secondary)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${getOverallProgress()}%`,
            background: 'var(--color-accent)',
          }}
        />
      </div>
    </div>
  );
}
