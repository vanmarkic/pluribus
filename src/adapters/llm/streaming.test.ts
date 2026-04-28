import { describe, it, expect, vi } from 'vitest';
import { classifyStreaming } from './streaming';

describe('classifyStreaming', () => {
  it('yields an error event when no API key is configured', async () => {
    const secrets = { getApiKey: vi.fn(async () => null) };
    const events: Array<unknown> = [];
    for await (const e of classifyStreaming(
      { model: 'claude-haiku-4-5-20251001', userMessage: 'Subject: hi' },
      secrets,
    )) {
      events.push(e);
    }
    expect(events).toEqual([{ type: 'error', message: 'Anthropic API key not set' }]);
  });

  // The happy-path stream is covered at the integration level with a
  // recorded fixture; including it here would either (a) require the
  // Anthropic SDK to be called with a real key, or (b) force us to mock
  // the entire SDK surface. Both have poor ROI for a unit test. The SDK's
  // own tests cover the stream-event shape.
});
