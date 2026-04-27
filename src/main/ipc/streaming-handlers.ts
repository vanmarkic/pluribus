/**
 * Streaming classifier IPC (#89).
 *
 * Exposes a single renderer-initiated streaming call: the renderer
 * invokes `llm:streamExplain` with a message id, the main process
 * opens an Anthropic stream, and forwards each text delta over a
 * dedicated event channel keyed by a request id. The renderer
 * subscribes to `llm:stream:<requestId>` for deltas and resolves the
 * original invoke promise with the full text on completion.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Container } from '../container';
import { classifyStreaming } from '../../adapters/llm';
import { parseInput } from './schemas';

const StreamExplainInput = z.object({
  emailId: z.number().int().positive(),
});

export function setupStreamingHandlers(container: Container, window: BrowserWindow): void {
  const { deps, config } = container;

  ipcMain.handle('llm:streamExplain', async (_event, input: unknown) => {
    const { emailId } = parseInput(StreamExplainInput, input, 'input');

    const email = await deps.emails.findById(emailId);
    if (!email) throw new Error('Email not found');
    const body = await deps.emails.getBody(emailId);

    const llmConfig = config.get('llm');
    if (llmConfig.provider !== 'anthropic') {
      throw new Error('Streaming explain only available on the Anthropic provider');
    }

    const requestId = randomUUID();

    // Build the same user message shape the classifier uses so the
    // streamed reasoning corresponds to what a real classify call would
    // produce.
    const userMessage = [
      `From: ${email.from.name ?? ''} <${email.from.address}>`,
      `Subject: ${email.subject}`,
      `Date: ${email.date.toISOString()}`,
      '',
      '<email_content>',
      body?.text?.slice(0, 2000) || email.snippet || '(empty)',
      '</email_content>',
    ].join('\n');

    // Fire-and-forget producer — the handler itself returns the requestId
    // immediately so the renderer can subscribe to the channel. Delta
    // events are pushed as they arrive; a final 'done' or 'error' event
    // closes the stream.
    (async () => {
      const channel = `llm:stream:${requestId}`;
      for await (const event of classifyStreaming(
        {
          model: llmConfig.model,
          userMessage,
        },
        deps.secrets,
      )) {
        if (window.isDestroyed()) return;
        window.webContents.send(channel, event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    })().catch(err => {
      if (!window.isDestroyed()) {
        window.webContents.send(`llm:stream:${requestId}`, {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { requestId };
  });
}
