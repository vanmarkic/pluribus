/**
 * Ollama LLM Provider
 *
 * Uses local Ollama server for email classification.
 * No API key required - just server URL.
 */

import type { LLMProvider, LLMModel, Classifier } from '../../core/ports';
import type { Email, EmailBody, Classification, TriageFolder } from '../../core/domain';

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

// Triage folders for classification
const TRIAGE_FOLDER_DESCRIPTIONS: Record<TriageFolder, string> = {
  'INBOX': 'General inbox for emails that need attention',
  'Planning': 'Emails requiring future action or planning (meetings, schedules, project planning)',
  'Review': 'Emails that need review or decision-making',
  'Paper-Trail/Invoices': 'Invoices, receipts, payment confirmations',
  'Paper-Trail/Admin': 'Administrative documents, contracts, legal',
  'Paper-Trail/Travel': 'Travel bookings, itineraries, confirmations',
  'Feed': 'Newsletters, digests, informational content',
  'Social': 'Social media notifications, friend updates, community',
  'Promotions': 'Marketing, sales, promotional offers',
  'Archive': 'Already processed or low-priority items',
};

function buildSystemPrompt(): string {
  const folderList = Object.entries(TRIAGE_FOLDER_DESCRIPTIONS)
    .map(([folder, desc]) => `- ${folder}: ${desc}`)
    .join('\n');

  return `You are an email sorting assistant. Analyze emails and suggest the best folder.

Available folders:
${folderList}

Rules:
- Suggest exactly ONE folder from the available list
- Be conservative: choose based on email content, not guesses
- Consider sender domain and subject patterns
- Use INBOX if no other folder is a clear match
- Invoices, receipts → Paper-Trail/Invoices
- Meeting/scheduling → Planning
- Newsletters → Feed
- Marketing/sales → Promotions

Respond with JSON only:
{"folder":"FolderName","confidence":0.0-1.0,"reasoning":"brief","priority":"high"|"normal"|"low"}`;
}

function buildUserMessage(email: Email, body?: EmailBody): string {
  const parts = [
    `From: ${email.from.name || ''} <${email.from.address}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.date.toISOString()}`,
  ];

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
  configSource: OllamaConfigSource
): Classifier {
  // Helper to get current config (supports both static and dynamic)
  const getConfig = (): OllamaConfig =>
    typeof configSource === 'function' ? configSource() : configSource;

  return {
    async classify(email: Email, body?: EmailBody): Promise<Classification> {
      // Ollama is free/local - no budget enforcement needed
      const config = getConfig();
      const systemPrompt = buildSystemPrompt();
      const userMessage = buildUserMessage(email, body);

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
        // Validate folder is a known triage folder
        const folder = parsed.folder as TriageFolder;
        const validFolders = Object.keys(TRIAGE_FOLDER_DESCRIPTIONS);
        if (!validFolders.includes(folder)) {
          console.warn(`Unknown folder "${folder}", defaulting to INBOX`);
          return {
            suggestedFolder: 'INBOX',
            confidence: 0.5,
            reasoning: `Unknown folder "${folder}" in response`,
            priority: 'normal',
          };
        }
        return {
          suggestedFolder: folder,
          confidence: parsed.confidence || 0,
          reasoning: parsed.reasoning || '',
          priority: parsed.priority || 'normal',
        };
      } catch {
        console.error('Failed to parse Ollama response:', content);
        return {
          suggestedFolder: 'INBOX',
          confidence: 0,
          reasoning: 'Parse error',
          priority: 'normal',
        };
      }
    },

    getBudget() {
      const config = getConfig();
      // Ollama is free, but we still track for UI consistency
      return { used: 0, limit: config.dailyBudget, allowed: true };
    },

    getEmailBudget() {
      // Ollama is free/local - no limit enforcement, always allowed
      // Still track count for UI display but limit=0 means unlimited
      return {
        used: todayEmailCount,
        limit: 0,
        allowed: true,
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
