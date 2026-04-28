/**
 * Passphrase bootstrap for email-body encryption (#99).
 *
 * Generates a 256-bit random passphrase on first run and stores it in
 * the OS keychain via the existing SecureStorage port. Every subsequent
 * run loads the same passphrase, so the derived content key is stable.
 *
 * Kept separate from body-cipher.ts so the cipher stays pure and unit-
 * testable, and so this file — which depends on the keychain port — can
 * be swapped for tests or alternative secret stores without touching
 * the crypto.
 */

import * as crypto from 'crypto';
import type { SecureStorage } from '../../core/ports';
import { deriveContentKey } from './body-cipher';

const KEYCHAIN_SERVICE = 'pluribus:body-cipher';

/**
 * Retrieve the stored passphrase, or generate + persist a new one on
 * first run. Returns the derived 32-byte content key — callers never
 * need to see the raw passphrase, which is also the audit-log story:
 * the keychain decorator records this as one 'credential.api_key.read'
 * event per startup.
 */
export async function loadOrCreateBodyKey(secrets: SecureStorage): Promise<Buffer> {
  const existing = await secrets.getApiKey(KEYCHAIN_SERVICE);
  if (existing) {
    return deriveContentKey(existing);
  }
  const fresh = crypto.randomBytes(32).toString('base64');
  await secrets.setApiKey(KEYCHAIN_SERVICE, fresh);
  return deriveContentKey(fresh);
}
