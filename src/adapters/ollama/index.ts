/**
 * Ollama Text Generation Adapter
 *
 * Simple adapter for text generation using local Ollama models.
 * Used for awaiting-reply classification.
 */

export type OllamaGenerateConfig = {
  serverUrl: string;
  model: string;
  timeoutMs?: number;
};

export type OllamaTextGenerator = {
  generate: (prompt: string) => Promise<string>;
  isAvailable: () => Promise<boolean>;
};

export function createOllamaTextGenerator(
  getConfig: () => OllamaGenerateConfig
): OllamaTextGenerator {
  return {
    async generate(prompt: string): Promise<string> {
      const config = getConfig();
      const timeoutMs = config.timeoutMs ?? 30000;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${config.serverUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            prompt,
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Ollama request failed: ${response.status}`);
        }

        const data = (await response.json()) as { response: string };
        return data.response.trim();
      } finally {
        clearTimeout(timeout);
      }
    },

    async isAvailable(): Promise<boolean> {
      const config = getConfig();
      try {
        const response = await fetch(`${config.serverUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
