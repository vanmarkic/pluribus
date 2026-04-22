/**
 * Body-migration repository (#99 follow-up).
 *
 * Raw SQL access to the email_bodies table bypassing the encryption
 * decorator. The migration needs to see the actual stored bytes to
 * decide which rows still need to be re-saved — going through
 * EmailRepo.getBody() would decrypt-and-re-encrypt healthy rows
 * pointlessly on every run.
 */

import Database from 'better-sqlite3';
import type { BodyMigrationRepo, PlaintextBodyRow } from '../../core/ports';
import { isEncrypted } from '../keychain/body-cipher';

function isRowPlaintext(row: { body_text: string | null; body_html: string | null }): boolean {
  const text = row.body_text ?? '';
  const html = row.body_html ?? '';
  // A row counts as fully encrypted only if every non-empty field carries
  // the v1: prefix — mixed rows (partial migration aborted) are still
  // "plaintext" so the next run picks them up.
  const textOk = text === '' || isEncrypted(text);
  const htmlOk = html === '' || isEncrypted(html);
  return !(textOk && htmlOk);
}

export function createBodyMigrationRepo(getDb: () => Database.Database): BodyMigrationRepo {
  return {
    async countByStatus() {
      const rows = getDb()
        .prepare(`SELECT body_text, body_html FROM email_bodies`)
        .all() as Array<{ body_text: string | null; body_html: string | null }>;
      let plaintext = 0;
      let encrypted = 0;
      for (const row of rows) {
        if (isRowPlaintext(row)) plaintext++;
        else encrypted++;
      }
      return { total: rows.length, plaintext, encrypted };
    },

    async listPlaintextRows() {
      const rows = getDb()
        .prepare(`SELECT email_id, body_text, body_html FROM email_bodies`)
        .all() as Array<{ email_id: number; body_text: string | null; body_html: string | null }>;
      return rows.filter(isRowPlaintext).map((row): PlaintextBodyRow => ({
        emailId: row.email_id,
        bodyText: row.body_text,
        bodyHtml: row.body_html,
      }));
    },
  };
}
