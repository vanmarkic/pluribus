import { describe, it, expect } from 'vitest';
import {
  deriveContentKey,
  encryptBody,
  decryptBody,
  isEncrypted,
  CIPHER_VERSION,
} from './body-cipher';

const KEY = deriveContentKey('a-very-secret-passphrase');

describe('encryptBody / decryptBody', () => {
  it('round-trips arbitrary text', () => {
    const input = 'Hi — quick note about the invoice. € 1,240.00 due Friday.';
    const encrypted = encryptBody(input, KEY);
    expect(encrypted).toMatch(new RegExp(`^${CIPHER_VERSION}:`));
    expect(decryptBody(encrypted, KEY)).toBe(input);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const input = 'same input';
    const a = encryptBody(input, KEY);
    const b = encryptBody(input, KEY);
    expect(a).not.toBe(b);
    // Both must still decrypt back to the same plaintext.
    expect(decryptBody(a, KEY)).toBe(input);
    expect(decryptBody(b, KEY)).toBe(input);
  });

  it('rejects a tampered envelope (GCM tag check)', () => {
    const encrypted = encryptBody('attack at dawn', KEY);
    // Flip one byte in the ciphertext portion.
    const flipped = encrypted.slice(0, -5) + (encrypted[encrypted.length - 5] === 'A' ? 'B' : 'A') + encrypted.slice(-4);
    expect(() => decryptBody(flipped, KEY)).toThrow();
  });

  it('rejects an envelope encrypted with a different key', () => {
    const encrypted = encryptBody('secret', KEY);
    const otherKey = deriveContentKey('different-passphrase');
    expect(() => decryptBody(encrypted, otherKey)).toThrow();
  });

  it('passes legacy plaintext rows through unchanged', () => {
    const legacy = 'plaintext from before encryption landed';
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptBody(legacy, KEY)).toBe(legacy);
  });

  it('recognises the v1 prefix', () => {
    const encrypted = encryptBody('x', KEY);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted('v1:not-real-but-has-prefix-yes')).toBe(true);
    expect(isEncrypted('plain')).toBe(false);
  });

  it('handles empty strings (encrypted form is still non-empty)', () => {
    const encrypted = encryptBody('', KEY);
    expect(encrypted).not.toBe('');
    expect(decryptBody(encrypted, KEY)).toBe('');
  });

  it('handles multi-KB bodies', () => {
    const big = 'x'.repeat(200_000);
    const encrypted = encryptBody(big, KEY);
    expect(decryptBody(encrypted, KEY)).toBe(big);
  });

  it('rejects a truncated envelope', () => {
    const encrypted = encryptBody('hi', KEY);
    // Drop the auth tag.
    const truncated = encrypted.slice(0, encrypted.length - 20);
    expect(() => decryptBody(truncated, KEY)).toThrow();
  });
});

describe('deriveContentKey', () => {
  it('is deterministic for the same passphrase', () => {
    const a = deriveContentKey('x');
    const b = deriveContentKey('x');
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('is different for different passphrases', () => {
    const a = deriveContentKey('x');
    const b = deriveContentKey('y');
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('returns a 32-byte key', () => {
    expect(deriveContentKey('x').length).toBe(32);
  });
});
