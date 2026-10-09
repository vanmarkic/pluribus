// src/adapters/db/migrations.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, initDb, getDb, closeDb } from './connection';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

describe('migrations', () => {
  let db: Database.Database;
  const testDbPath = '/tmp/test-migrations.sqlite';

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);

    // Create minimal schema for emails and classification_state tables
    db.exec(`
      CREATE TABLE emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT,
        subject TEXT,
        from_address TEXT,
        from_name TEXT,
        to_addresses TEXT,
        cc_addresses TEXT,
        date TEXT,
        snippet TEXT,
        body_text TEXT,
        body_html TEXT,
        flags TEXT,
        raw_headers TEXT,
        UNIQUE(folder_id, uid)
      );

      CREATE TABLE classification_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id INTEGER NOT NULL UNIQUE,
        classification TEXT,
        confidence REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('adds thread columns to emails table', () => {
    runMigrations(db);

    const columns = db.prepare(`PRAGMA table_info(emails)`).all() as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('in_reply_to');
    expect(columnNames).toContain('references');
    expect(columnNames).toContain('thread_id');
  });

  it('adds awaiting reply columns to emails table', () => {
    runMigrations(db);

    const columns = db.prepare(`PRAGMA table_info(emails)`).all() as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('awaiting_reply');
    expect(columnNames).toContain('awaiting_reply_since');
  });

  it('adds unsubscribe columns to emails table', () => {
    runMigrations(db);

    const columns = db.prepare(`PRAGMA table_info(emails)`).all() as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('list_unsubscribe');
    expect(columnNames).toContain('list_unsubscribe_post');
  });

  it('creates thread index', () => {
    runMigrations(db);

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='emails'`).all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_emails_thread');
  });

  it('creates awaiting reply index', () => {
    runMigrations(db);

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='emails'`).all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_emails_awaiting');
  });

  it('creates unsubscribe index', () => {
    runMigrations(db);

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='emails'`).all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_emails_unsubscribe');
  });

  it('creates the reply digest indexes on emails', () => {
    runMigrations(db);

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='emails'`)
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_emails_in_reply_to');
    expect(indexNames).toContain('idx_emails_account_from_date');
    expect(indexNames).toContain('idx_emails_thread');
  });

  it('is idempotent - can run multiple times without error', () => {
    runMigrations(db);
    runMigrations(db);
    runMigrations(db);

    const columns = db.prepare(`PRAGMA table_info(emails)`).all() as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('thread_id');
  });
});

describe('reply digest + System 1 schema', () => {
  const NEW_TABLES = ['email_signals', 'reply_reminders', 'system1_heads'];
  const NEW_EMAIL_INDEXES = [
    'idx_emails_in_reply_to',
    'idx_emails_account_from_date',
    'idx_emails_thread',
  ];

  const tableNames = (d: Database.Database) =>
    (
      d.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    ).map((t) => t.name);
  const indexNames = (d: Database.Database, table: string) =>
    (
      d.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`).all(table) as {
        name: string;
      }[]
    ).map((i) => i.name);

  afterEach(() => {
    closeDb();
  });

  it('creates the tables and indexes on a fresh database', () => {
    const d = initDb(':memory:', SCHEMA_PATH);

    expect(tableNames(d)).toEqual(expect.arrayContaining(NEW_TABLES));
    expect(indexNames(d, 'email_signals')).toContain('idx_email_signals_email');
    expect(indexNames(d, 'emails')).toEqual(expect.arrayContaining(NEW_EMAIL_INDEXES));
  });

  it('enables foreign keys so reply digest rows cascade with their email', () => {
    const d = initDb(':memory:', SCHEMA_PATH);
    expect(d.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  describe('upgrading a legacy database', () => {
    let dir: string;
    let dbPath: string;

    /** The schema as shipped before the reply digest: everything above its banner. */
    const legacySchema = () => {
      const full = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      const cut = full.indexOf('-- Reply digest + System 1');
      expect(cut).toBeGreaterThan(0);
      return full.slice(0, cut);
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluribus-legacy-db-'));
      dbPath = path.join(dir, 'mail.db');

      // Build a pre-digest database: old schema, no migration 005 columns, real data.
      const legacy = new Database(dbPath);
      legacy.pragma('foreign_keys = ON');
      legacy.exec(legacySchema());
      legacy.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
                   VALUES ('Legacy', 'me@legacy.com', 'imap.legacy.com', 'smtp.legacy.com', 'me')`);
      legacy.exec(`INSERT INTO folders (account_id, path, name) VALUES (1, 'INBOX', 'Inbox')`);
      legacy.exec(`INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date)
                   VALUES ('<old>', 1, 1, 1, 'a@x.com', '["me@legacy.com"]', '2025-01-01T00:00:00.000Z')`);
      legacy.close();
    });

    afterEach(() => {
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('starts without the new tables or columns', () => {
      const legacy = new Database(dbPath, { readonly: true });
      try {
        expect(tableNames(legacy)).not.toEqual(expect.arrayContaining(NEW_TABLES));
        const columns = (
          legacy.prepare('PRAGMA table_info(emails)').all() as { name: string }[]
        ).map((c) => c.name);
        expect(columns).not.toContain('in_reply_to');
      } finally {
        legacy.close();
      }
    });

    it('adds the tables and indexes and keeps existing data', () => {
      const d = initDb(dbPath, SCHEMA_PATH);

      expect(tableNames(d)).toEqual(expect.arrayContaining(NEW_TABLES));
      expect(indexNames(d, 'email_signals')).toContain('idx_email_signals_email');
      expect(indexNames(d, 'emails')).toEqual(expect.arrayContaining(NEW_EMAIL_INDEXES));

      const email = d.prepare('SELECT message_id, thread_id FROM emails WHERE id = 1').get();
      expect(email).toEqual({ message_id: '<old>', thread_id: null });
    });

    it('is safe to open the upgraded database again', () => {
      initDb(dbPath, SCHEMA_PATH);
      closeDb();

      const d = initDb(dbPath, SCHEMA_PATH);
      expect(tableNames(d)).toEqual(expect.arrayContaining(NEW_TABLES));
      expect(indexNames(d, 'emails')).toEqual(expect.arrayContaining(NEW_EMAIL_INDEXES));
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM emails').get()).toEqual({ n: 1 });
    });

    it('supports signals on legacy emails', () => {
      const d = initDb(dbPath, SCHEMA_PATH);
      d.prepare(
        `INSERT INTO email_signals (email_id, source, needs_reply) VALUES (1, 'system2', 1)`,
      ).run();
      d.prepare('DELETE FROM emails WHERE id = 1').run();
      expect(d.prepare('SELECT COUNT(*) AS n FROM email_signals').get()).toEqual({ n: 0 });
    });
  });
});
