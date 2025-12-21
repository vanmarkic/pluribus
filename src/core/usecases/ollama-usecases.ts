/**
 * Ollama Use Cases
 *
 * Business logic for Ollama lifecycle management.
 */

// Port interface - minimal subset needed for startup
export type OllamaRunner = {
  isInstalled: () => Promise<boolean>;
  isRunning: () => Promise<boolean>;
  start: () => Promise<void>;
};

export type OllamaConfig = {
  provider: 'ollama' | 'anthropic';
};

export type StartOllamaResult =
  | { started: true }
  | { started: false; reason: 'provider-not-ollama' | 'not-installed' | 'already-running' }
  | { started: false; reason: 'start-failed'; error: string };

export type StartOllamaOnLaunchDeps = {
  runner: OllamaRunner;
  config: OllamaConfig;
};

/**
 * Start Ollama server on app launch if conditions are met.
 *
 * Starts automatically when:
 * - Provider is set to 'ollama'
 * - Binary is installed
 * - Not already running
 */
export async function startOllamaOnLaunch(deps: StartOllamaOnLaunchDeps): Promise<StartOllamaResult> {
  const { runner, config } = deps;

  // Check provider
  if (config.provider !== 'ollama') {
    return { started: false, reason: 'provider-not-ollama' };
  }

  // Check binary installed
  const isInstalled = await runner.isInstalled();
  if (!isInstalled) {
    return { started: false, reason: 'not-installed' };
  }

  // Check already running
  const isRunning = await runner.isRunning();
  if (isRunning) {
    return { started: false, reason: 'already-running' };
  }

  // Try to start
  try {
    await runner.start();
    return { started: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { started: false, reason: 'start-failed', error };
  }
}
