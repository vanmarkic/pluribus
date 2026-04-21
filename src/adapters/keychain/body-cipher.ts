/**
 * AES-256-GCM envelope encryption for email body text/HTML (#99).
 *
 * Rationale
 * =========
 * `email_bodies` is the largest plaintext footprint on disk. Anyone with
 * filesystem access (backup leak, stolen laptop post-login, rogue
 * system-admin) reads every message the user ever synced. This module
 * wraps a body string in an AES-GCM envelope using a key derived from
 * Electron's safeStorage — so the key lives in the OS keychain and
 * never touches the SQLite file.
 *
 * Wire format (versioned, base64 string):
 *   `v1:${base64(iv || ciphertext || authTag)}`
 *
 * - version prefix lets us rotate crypto without a schema migration;
 * - iv is 12 random bytes per call (GCM NIST recommendation);
 * - ciphertext is authenticated with GCM's 16-byte tag appended.
 *
 * Legacy plaintext rows are recognised by the absence of the `v1:`
 * prefix; decrypt() returns them unchanged so existing databases keep
 * working without a forced migration.
 */

import * as crypto from 'crypto';

export const CIPHER_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

/**
 * Derive a 256-bit content-encryption key from a passphrase the caller
 * retrieves from the OS keychain. HKDF with a fixed application salt —
 * the passphrase itself is the entropy source, HKDF is just the
 * extract/expand shape.
 */
export function deriveContentKey(passphrase: Buffer | string): Buffer {
  const pw = typeof passphrase === 'string' ? Buffer.from(passphrase, 'utf8') : passphrase;
  const salt = Buffer.from('pluribus:body-cipher:v1', 'utf8');
  // Node's hkdfSync returns an ArrayBuffer.
  const keyBytes = crypto.hkdfSync('sha256', pw, salt, Buffer.from('aes-256-gcm-key'), 32);
  return Buffer.from(keyBytes);
}

export function encryptBody(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, enc, tag]);
  return `${CIPHER_VERSION}:${envelope.toString('base64')}`;
}

export function decryptBody(stored: string, key: Buffer): string {
  // Legacy plaintext row — let it through unchanged so pre-encryption
  // databases keep working. Callers that want strict mode can gate on
  // isEncrypted() themselves.
  if (!stored.startsWith(`${CIPHER_VERSION}:`)) return stored;

  const envelope = Buffer.from(stored.slice(CIPHER_VERSION.length + 1), 'base64');
  if (envelope.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted body envelope is too short to be valid');
  }
  const iv = envelope.subarray(0, IV_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);
  const ciphertext = envelope.subarray(IV_BYTES, envelope.length - TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(`${CIPHER_VERSION}:`);
}
