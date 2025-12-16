/**
 * Ollama LLM Provider
 *
 * Uses local Ollama server for email classification.
 * No API key required - just server URL.
 */

import type { LLMProvider, LLMModel, Classifier } from '../../core/ports';
import type { Email, EmailBody, Classification, Tag } from '../../core/domain';

const DEFAULT_SERVER_URL = 'http://localhost:11434';

type OllamaTagsResponse = {
  models?: Array<{ name: string; modified_at?: string }>;
};

type OllamaChatResponse = {
  message?: { content?: string };
};

export function createOllamaProvider(serverUrl = DEFAULT_SERVER_URL): LLMProvider {
  return {
    type: 'ollama',

    async validateKey() {
      // Ollama doesn't need API key, just test connection
      const result = await this.testConnection!();
      return { valid: result.connected, error: result.error };
    },

    async listModels() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json() as OllamaTagsResponse;

        return (data.models || []).map((m) => ({
          id: m.name,
          displayName: m.name,
          createdAt: m.modified_at,
        }));
      } catch (err) {
        console.error('Failed to list Ollama models:', err);
        return [];
      }
    },

    async testConnection() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          return { connected: false, error: `Server returned ${response.status}` };
        }
        const data = await response.json() as OllamaTagsResponse;
        if (!data.models || data.models.length === 0) {
          return { connected: true, error: "No models installed. Run 'ollama pull llama3.2' to install one." };
        }
        return { connected: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
          return { connected: false, error: "Ollama is not running. Start it with 'ollama serve'" };
        }
        if (message.includes('timeout') || message.includes('aborted')) {
          return { connected: false, error: "Connection timed out. Is Ollama running?" };
        }
        return { connected: false, error: message };
      }
    },
  };
}

function buildSystemPrompt(tags: Tag[]): string {
  const tagList = tags
    .filter(t => !t.isSystem)
    .map(t => `- ${t.slug}: ${t.name}`)
    .join('\n');

  return `You are an email sorting assistant. Analyze emails and suggest tags.

Available tags:
${tagList}

Rules:
- Suggest 1-3 relevant tags from the available list
- Be conservative: only suggest confident matches
- Consider sender domain and subject patterns
- If no existing tag fits well, you may suggest ONE new tag (use lowercase slug format with hyphens, e.g. "project-updates")
- Only create a new tag if it would be genuinely useful for categorizing future similar emails

Respond with JSON only:
{"tags":["slug"],"confidence":0.0-1.0,"reasoning":"brief","priority":"high"|"normal"|"low","newTag":{"slug":"new-tag-slug","name":"New Tag Name"}|null}`;
}

function buildUserMessage(email: Email, body?: EmailBody, existingTags?: string[]): string {
  const parts = [
    `From: ${email.from.name || ''} <${email.from.address}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.date.toISOString()}`,
  ];

  if (existingTags?.length) {
    parts.push(`Current tags: ${existingTags.join(', ')}`);
  }

  parts.push('', 'Content:', body?.text?.slice(0, 2000) || email.snippet || '(empty)');

  return parts.join('\n');
}

type OllamaConfig = {
  model: string;
  serverUrl: string;
  dailyBudget: number;
  dailyEmailLimit: number;
};

// Support both static config and dynamic config getter
type OllamaConfigSource = OllamaConfig | (() => OllamaConfig);

let todayEmailCount = 0;

export function createOllamaClassifier(
  configSource: OllamaConfigSource,
  tagRepo: { findAll: () => Promise<Tag[]> }
): Classifier {
  // Helper to get current config (supports both static and dynamic)
  const getConfig = (): OllamaConfig =>
    typeof configSource === 'function' ? configSource() : configSource;

  return {
    async classify(email, body, existingTags) {
      const budget = this.getEmailBudget();
      if (!budget.allowed) {
        throw new Error(`Daily budget exceeded (${budget.used}/${budget.limit})`);
      }

      const config = getConfig();
      const tags = await tagRepo.findAll();
      const systemPrompt = buildSystemPrompt(tags);
      const userMessage = buildUserMessage(email, body, existingTags);

      let response;
      try {
        response = await fetch(`${config.serverUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            stream: false,
            options: { temperature: 0.2 },
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
          throw new Error("Ollama server is not running. Start it with 'ollama serve' or click 'Start Ollama Server' in settings.");
        }
        throw new Error(`Failed to connect to Ollama: ${message}`);
      }

      if (!response.ok) {
        const statusText = response.status === 404
          ? `Model '${config.model}' not found. Pull it with: ollama pull ${config.model}`
          : `Server error (${response.status})`;
        throw new Error(`Ollama API error: ${statusText}`);
      }

      const data = await response.json() as OllamaChatResponse;
      todayEmailCount++;

      const content = data.message?.content || '';

      try {
        const parsed = JSON.parse(content);
        return {
          suggestedTags: parsed.tags || [],
          confidence: parsed.confidence || 0,
          reasoning: parsed.reasoning || '',
          priority: parsed.priority || 'normal',
          newTag: parsed.newTag || null,
        };
      } catch {
        console.error('Failed to parse Ollama response:', content);
        return {
          suggestedTags: [],
          confidence: 0,
          reasoning: 'Parse error',
          priority: 'normal',
          newTag: null,
        };
      }
    },

    getBudget() {
      const config = getConfig();
      // Ollama is free, but we still track for UI consistency
      return { used: 0, limit: config.dailyBudget, allowed: true };
    },

    getEmailBudget() {
      const config = getConfig();
      return {
        used: todayEmailCount,
        limit: config.dailyEmailLimit,
        allowed: todayEmailCount < config.dailyEmailLimit,
      };
    },
  };
}

export function resetOllamaDailyUsage(): void {
  todayEmailCount = 0;
}

/**
 * Reset email count (for testing)
 */
export function resetOllamaEmailCount(): void {
  todayEmailCount = 0;
}

/**
 * Start the Ollama server if not already running.
 * Returns true if server is running (either started or already was running).
 */
export async function startOllama(serverUrl = DEFAULT_SERVER_URL): Promise<{ started: boolean; error?: string }> {
  console.log('[Ollama] Checking if server is running...');

  // First check if already running
  try {
    const response = await fetch(`${serverUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      console.log('[Ollama] Server is already running');
      return { started: true }; // Already running
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[Ollama] Server not responding:', message);
    // Not running, try to start
  }

  console.log('[Ollama] Attempting to start Ollama server...');

  try {
    const { spawn } = await import('child_process');

    // Start ollama serve in background
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref(); // Don't wait for child process

    console.log('[Ollama] Spawned ollama serve process, waiting for it to be ready...');

    // Wait for server to be ready (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const response = await fetch(`${serverUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          console.log('[Ollama] Server started successfully');
          return { started: true };
        }
      } catch {
        // Still starting up, continue waiting
        if (i % 4 === 0) {
          console.log(`[Ollama] Still waiting... (${i / 2}s)`);
        }
      }
    }

    console.error('[Ollama] Server did not start within 10 seconds');
    return { started: false, error: 'Ollama server did not start within 10 seconds. It may be starting in the background - try again in a moment.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Ollama] Failed to start:', message);

    // Check for ENOENT (command not found)
    if (message.includes('ENOENT') || (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { started: false, error: 'Ollama is not installed. Install from https://ollama.ai' };
    }

    return { started: false, error: `Failed to start Ollama: ${message}` };
  }
}

/**
 * Stop the Ollama server process.
 * This should be called after classification batch completes to free resources.
 */
export async function stopOllama(): Promise<void> {
  try {
    // Ollama doesn't have a built-in stop API, so we use pkill
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Kill the ollama serve process gracefully
    await execAsync('pkill -f "ollama serve"').catch(() => {
      // Process might not be running, that's fine
    });

    console.log('Ollama server stopped');
  } catch (err) {
    console.error('Failed to stop Ollama:', err);
  }
}
