/**
 * Embedding Repository
 * 
 * Database operations for storing and retrieving email embeddings.
 */

import type * as BetterSqlite3 from 'better-sqlite3';
import type { EmbeddingRepo } from '../../core/ports';
import type { EmailEmbedding } from '../../core/domain';
import { serializeEmbedding, deserializeEmbedding } from './index';

type Database = BetterSqlite3.Database;

type EmbeddingRow = {
  id: number;
  email_id: number;
  embedding: Buffer;
  embedding_model: string;
  folder: string;
  is_correction: number;
  created_at: string;
};

function mapEmbedding(row: EmbeddingRow): EmailEmbedding {
  return {
    id: row.id,
    emailId: row.email_id,
    embedding: deserializeEmbedding(row.embedding),
    embeddingModel: row.embedding_model,
    folder: row.folder,
    isCorrection: !!row.is_correction,
    createdAt: new Date(row.created_at),
  };
}

export function createEmbeddingRepo(db: Database): EmbeddingRepo {
  return {
    async findByEmail(emailId: number, model?: string): Promise<EmailEmbedding | null> {
      const stmt = model
        ? db.prepare(`
            SELECT * FROM email_embeddings
            WHERE email_id = ? AND embedding_model = ?
          `)
        : db.prepare(`
            SELECT * FROM email_embeddings
            WHERE email_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `);

      const row = model
        ? stmt.get(emailId, model) as EmbeddingRow | undefined
        : stmt.get(emailId) as EmbeddingRow | undefined;

      return row ? mapEmbedding(row) : null;
    },

    async findAll(model?: string, accountId?: number): Promise<EmailEmbedding[]> {
      let query = `
        SELECT e.* FROM email_embeddings e
      `;

      const params: any[] = [];

      if (accountId !== undefined) {
        query += `
          INNER JOIN emails em ON e.email_id = em.id
          WHERE em.account_id = ?
        `;
        params.push(accountId);
      }

      if (model !== undefined) {
        query += accountId !== undefined ? ' AND ' : ' WHERE ';
        query += 'e.embedding_model = ?';
        params.push(model);
      }

      query += ' ORDER BY e.created_at DESC';

      const stmt = db.prepare(query);
      const rows = stmt.all(...params) as EmbeddingRow[];

      return rows.map(mapEmbedding);
    },

    async save(
      emailId: number,
      embedding: number[],
      folder: string,
      isCorrection: boolean,
      model: string
    ): Promise<EmailEmbedding> {
      const serialized = serializeEmbedding(embedding);

      const stmt = db.prepare(`
        INSERT INTO email_embeddings (email_id, embedding, folder, is_correction, embedding_model)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email_id, embedding_model) DO UPDATE SET
          embedding = excluded.embedding,
          folder = excluded.folder,
          is_correction = excluded.is_correction
        RETURNING *
      `);

      const row = stmt.get(emailId, serialized, folder, isCorrection ? 1 : 0, model) as EmbeddingRow;

      return mapEmbedding(row);
    },

    async delete(emailId: number): Promise<void> {
      const stmt = db.prepare('DELETE FROM email_embeddings WHERE email_id = ?');
      stmt.run(emailId);
    },

    async count(model?: string): Promise<number> {
      const stmt = model
        ? db.prepare('SELECT COUNT(*) as count FROM email_embeddings WHERE embedding_model = ?')
        : db.prepare('SELECT COUNT(*) as count FROM email_embeddings');

      const row = model
        ? stmt.get(model) as { count: number }
        : stmt.get() as { count: number };

      return row.count;
    },
  };
}
