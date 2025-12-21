/**
 * Tests for startOllamaOnLaunch use case
 *
 * Business rules:
 * 1. Only start if provider is 'ollama'
 * 2. Only start if ollama setup is complete
 * 3. Only start if binary is installed
 * 4. Don't start if already running
 * 5. Fail gracefully (non-fatal errors)
 */

import { describe, test, expect, vi } from 'vitest';
import { startOllamaOnLaunch } from '../usecases/ollama-usecases';

// Minimal port interfaces for testing
type OllamaRunner = {
  isInstalled: () => Promise<boolean>;
  isRunning: () => Promise<boolean>;
  start: () => Promise<void>;
};

type OllamaConfig = {
  provider: 'ollama' | 'anthropic';
  setupComplete: boolean;
};

function createMockRunner(overrides: Partial<OllamaRunner> = {}): OllamaRunner {
  return {
    isInstalled: vi.fn().mockResolvedValue(true),
    isRunning: vi.fn().mockResolvedValue(false),
    start: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('startOllamaOnLaunch', () => {
  test('starts Ollama when provider is ollama, setup complete, installed, and not running', async () => {
    const runner = createMockRunner();
    const config: OllamaConfig = { provider: 'ollama', setupComplete: true };

    const result = await startOllamaOnLaunch({ runner, config });

    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ started: true });
  });

  test('skips when provider is not ollama', async () => {
    const runner = createMockRunner();
    const config: OllamaConfig = { provider: 'anthropic', setupComplete: true };

    const result = await startOllamaOnLaunch({ runner, config });

    expect(runner.isInstalled).not.toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
    expect(result).toEqual({ started: false, reason: 'provider-not-ollama' });
  });

  test('skips when setup is not complete', async () => {
    const runner = createMockRunner();
    const config: OllamaConfig = { provider: 'ollama', setupComplete: false };

    const result = await startOllamaOnLaunch({ runner, config });

    expect(runner.isInstalled).not.toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
    expect(result).toEqual({ started: false, reason: 'setup-incomplete' });
  });

  test('skips when binary is not installed', async () => {
    const runner = createMockRunner({
      isInstalled: vi.fn().mockResolvedValue(false),
    });
    const config: OllamaConfig = { provider: 'ollama', setupComplete: true };

    const result = await startOllamaOnLaunch({ runner, config });

    expect(runner.start).not.toHaveBeenCalled();
    expect(result).toEqual({ started: false, reason: 'not-installed' });
  });

  test('skips when already running', async () => {
    const runner = createMockRunner({
      isRunning: vi.fn().mockResolvedValue(true),
    });
    const config: OllamaConfig = { provider: 'ollama', setupComplete: true };

    const result = await startOllamaOnLaunch({ runner, config });

    expect(runner.start).not.toHaveBeenCalled();
    expect(result).toEqual({ started: false, reason: 'already-running' });
  });

  test('returns error result when start fails (non-fatal)', async () => {
    const runner = createMockRunner({
      start: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });
    const config: OllamaConfig = { provider: 'ollama', setupComplete: true };

    const result = await startOllamaOnLaunch({ runner, config });

    expect(result).toEqual({
      started: false,
      reason: 'start-failed',
      error: 'Connection refused',
    });
  });
});
