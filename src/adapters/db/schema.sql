-- Mail Client Database Schema
-- SQLite with FTS5 for full-text search

PRAGMA foreign_keys = ON;

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  username TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_sync TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Folders
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  uid_validity INTEGER,
  last_uid INTEGER DEFAULT 0,
  UNIQUE(account_id, path)
);

-- Emails (headers only for fast listing)
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  subject TEXT,
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_addresses TEXT NOT NULL,
  date TEXT NOT NULL,
  snippet TEXT,
  size_bytes INTEGER DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  body_fetched INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id);
CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder_id);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_unread ON emails(account_id, is_read) WHERE is_read = 0;
CREATE INDEX IF NOT EXISTS idx_emails_starred ON emails(account_id, is_starred) WHERE is_starred = 1;

-- Email Bodies (lazy loaded)
CREATE TABLE IF NOT EXISTS email_bodies (
  email_id INTEGER PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  body_text TEXT,
  body_html TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Attachments
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  cid TEXT,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);

-- Full-Text Search
CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
  subject, from_address, from_name, snippet,
  content='emails', content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
  INSERT INTO emails_fts(rowid, subject, from_address, from_name, snippet)
  VALUES (new.id, new.subject, new.from_address, new.from_name, new.snippet);
END;

CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, from_address, from_name, snippet)
  VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.snippet);
END;

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#6b7280',
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email Tags Junction
CREATE TABLE IF NOT EXISTS email_tags (
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  confidence REAL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_email_tags_tag ON email_tags(tag_id);

-- LLM Usage
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, model)
);

-- Default Tags
INSERT OR IGNORE INTO tags (slug, name, color, is_system, sort_order) VALUES
  ('inbox', 'Inbox', '#3b82f6', 1, 0),
  ('sent', 'Sent', '#10b981', 1, 1),
  ('archive', 'Archive', '#6b7280', 1, 2),
  ('trash', 'Trash', '#ef4444', 1, 3);

INSERT OR IGNORE INTO tags (slug, name, color, sort_order) VALUES
  ('work', 'Work', '#8b5cf6', 10),
  ('personal', 'Personal', '#ec4899', 11),
  ('finance', 'Finance', '#14b8a6', 12);
