// src/adapters/db/migrations.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './connection';
import fs from 'fs';
import path from 'path';

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

  it('is idempotent - can run multiple times without error', () => {
    runMigrations(db);
    runMigrations(db);
    runMigrations(db);

    const columns = db.prepare(`PRAGMA table_info(emails)`).all() as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('thread_id');
  });
});
