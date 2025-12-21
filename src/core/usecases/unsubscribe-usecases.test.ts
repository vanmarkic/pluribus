// src/core/usecases/unsubscribe-usecases.test.ts
import { describe, it, expect } from 'vitest';
import { parseUnsubscribe } from './unsubscribe-usecases';

describe('parseUnsubscribe', () => {
  it('parses mailto link', () => {
    const result = parseUnsubscribe('<mailto:unsubscribe@example.com>');

    expect(result.mailto).toBe('unsubscribe@example.com');
    expect(result.https).toBeNull();
  });

  it('parses https link', () => {
    const result = parseUnsubscribe('<https://example.com/unsubscribe>');

    expect(result.https).toBe('https://example.com/unsubscribe');
    expect(result.mailto).toBeNull();
  });

  it('parses both mailto and https', () => {
    const result = parseUnsubscribe('<mailto:unsub@example.com>, <https://example.com/unsub>');

    expect(result.mailto).toBe('unsub@example.com');
    expect(result.https).toBe('https://example.com/unsub');
  });

  it('detects one-click from post header', () => {
    const result = parseUnsubscribe(
      '<https://example.com/unsub>',
      'List-Unsubscribe=One-Click'
    );

    expect(result.oneClick).toBe(true);
  });

  it('returns empty when no unsubscribe header', () => {
    const result = parseUnsubscribe(null);

    expect(result.mailto).toBeNull();
    expect(result.https).toBeNull();
    expect(result.oneClick).toBe(false);
  });
});
