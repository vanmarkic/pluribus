/**
 * Streaming classifier (#89).
 *
 * Yields text deltas as they arrive from Anthropic so the UI can show
 * reasoning token-by-token. Stand-alone from createClassifier() — the
 * streaming path has a simpler contract (no agent loop, no pattern
 * cache, no budget bookkeeping) because it's only used for the on-demand
 * "explain this classification" UI flow, not bulk triage.
 *
 * The caller provides a secretsProvider so this module doesn't import
 * electron/keychain directly, keeping the file unit-testable.
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, PRODUCTION_VERSION, type PromptVersion } from './prompts/loader';

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; fullText: string }
  | { type: 'error'; message: string };

export type StreamingClassifyInput = {
  model: string;
  promptVersion?: PromptVersion;
  userMessage: string;
};

export type SecretsProvider = {
  getApiKey: (service: string) => Promise<string | null>;
};

/**
 * Classify an email with streaming reasoning. Returns an async iterable
 * of text deltas + a final 'done' event carrying the full accumulated
 * text. Callers should consume with `for await (const event of …)`.
 */
export async function* classifyStreaming(
  input: StreamingClassifyInput,
  secrets: SecretsProvider,
): AsyncGenerator<StreamEvent, void, unknown> {
  const apiKey = await secrets.getApiKey('anthropic');
  if (!apiKey) {
    yield { type: 'error', message: 'Anthropic API key not set' };
    return;
  }

  const client = new Anthropic({ apiKey });
  const prompt = loadPrompt(input.promptVersion ?? PRODUCTION_VERSION);

  let fullText = '';
  try {
    const stream = client.messages.stream({
      model: input.model,
      max_tokens: 1024,
      temperature: 0.2,
      system: [{ type: 'text', text: prompt.text, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: input.userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const delta = event.delta.text;
        fullText += delta;
        yield { type: 'text', delta };
      }
    }

    yield { type: 'done', fullText };
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
