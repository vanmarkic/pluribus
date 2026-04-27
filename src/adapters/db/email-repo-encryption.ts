/**
 * Encryption decorator for EmailRepo (#99).
 *
 * Wraps the raw EmailRepo so saveBody() encrypts text/html before
 * persisting and getBody() decrypts on read. Legacy plaintext rows are
 * passed through unchanged thanks to the `v1:` prefix sniff in
 * body-cipher — so pre-encryption databases keep working without a
 * forced migration, and the migration can run opportunistically (each
 * email is re-encrypted the next time its body is re-saved).
 *
 * Kept intentionally narrow — only the two body-bearing methods need
 * the decorator; everything else is a straight pass-through. This keeps
 * the blast radius small and makes the "what's actually encrypted"
 * invariant easy to audit.
 */

import type { EmailRepo } from '../../core/ports';
import type { EmailBody } from '../../core/domain';
import { encryptBody, decryptBody } from '../keychain/body-cipher';

export function wrapEmailRepoWithEncryption(
  inner: EmailRepo,
  key: Buffer,
): EmailRepo {
  return {
    ...inner,

    async saveBody(id, body) {
      const encrypted: EmailBody = {
        text: body.text ? encryptBody(body.text, key) : body.text,
        html: body.html ? encryptBody(body.html, key) : body.html,
      };
      return inner.saveBody(id, encrypted);
    },

    async getBody(id) {
      const row = await inner.getBody(id);
      if (!row) return null;
      return {
        text: row.text ? decryptBody(row.text, key) : row.text,
        html: row.html ? decryptBody(row.html, key) : row.html,
      };
    },
  };
}
