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

-- Tags table removed - using folders for organization instead
-- See Issue #54: Email organization is now folder-based only

-- Drafts (local email drafts)
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_addresses TEXT NOT NULL DEFAULT '[]',
  cc_addresses TEXT NOT NULL DEFAULT '[]',
  bcc_addresses TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  body_html TEXT,
  in_reply_to TEXT,
  references_list TEXT NOT NULL DEFAULT '[]',
  original_email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_drafts_account ON drafts(account_id);
CREATE INDEX IF NOT EXISTS idx_drafts_saved_at ON drafts(saved_at DESC);

-- Draft Attachments
CREATE TABLE IF NOT EXISTS draft_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_draft_attachments_draft ON draft_attachments(draft_id);

-- LLM Usage
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, model)
);

-- Classification State (tracks each email's AI classification status)
CREATE TABLE IF NOT EXISTS classification_state (
  email_id INTEGER PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unprocessed',  -- unprocessed, classified, pending_review, accepted, dismissed, error
  confidence REAL,
  priority TEXT,  -- high, normal, low
  suggested_folder TEXT,  -- Target triage folder
  reasoning TEXT,
  error_message TEXT,  -- Error message if classification failed
  classified_at TEXT,
  reviewed_at TEXT,
  dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_classification_status ON classification_state(status);
CREATE INDEX IF NOT EXISTS idx_classification_confidence ON classification_state(confidence);

-- Classification Feedback (logs user actions for accuracy tracking)
CREATE TABLE IF NOT EXISTS classification_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  action TEXT NOT NULL,  -- accept, accept_edit, dismiss
  original_folder TEXT,  -- What AI suggested
  final_folder TEXT,     -- What user applied (null if dismissed)
  accuracy_score REAL,   -- 1.0 for accept, 0.98 for accept_edit, 0.0 for dismiss
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_email ON classification_feedback(email_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON classification_feedback(created_at);

-- Confused Patterns (aggregates patterns where AI struggles)
CREATE TABLE IF NOT EXISTS confused_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_type TEXT NOT NULL,  -- sender_domain, subject_pattern
  pattern_value TEXT NOT NULL,
  dismissal_count INTEGER NOT NULL DEFAULT 0,
  avg_confidence REAL,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pattern_type, pattern_value)
);

CREATE INDEX IF NOT EXISTS idx_confused_patterns_count ON confused_patterns(dismissal_count DESC);

-- Recent Contacts (for autocomplete)
CREATE TABLE IF NOT EXISTS recent_contacts (
  address TEXT PRIMARY KEY,
  name TEXT,
  use_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recent_contacts_score
  ON recent_contacts(use_count DESC, last_used_at DESC);

-- ============================================
-- Email Triage System
-- ============================================

-- Training examples (onboarding + corrections)
CREATE TABLE IF NOT EXISTS training_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  from_address TEXT NOT NULL,
  from_domain TEXT NOT NULL,
  subject TEXT NOT NULL,
  ai_suggestion TEXT,
  user_choice TEXT NOT NULL,
  was_correction INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',  -- onboarding, review_folder, manual_move
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_training_account ON training_examples(account_id);
CREATE INDEX IF NOT EXISTS idx_training_domain ON training_examples(from_domain);
CREATE INDEX IF NOT EXISTS idx_training_correction ON training_examples(was_correction);

-- Sender-based learned rules
CREATE TABLE IF NOT EXISTS sender_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'domain',  -- domain, email, subject_prefix
  target_folder TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  correction_count INTEGER NOT NULL DEFAULT 1,
  auto_apply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, pattern, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_sender_rules_account ON sender_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_sender_rules_auto ON sender_rules(auto_apply) WHERE auto_apply = 1;

-- Email snoozes
CREATE TABLE IF NOT EXISTS email_snoozes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  snooze_until TEXT NOT NULL,
  original_folder TEXT NOT NULL,
  reason TEXT,  -- shipping, waiting_reply, manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email_id)
);

CREATE INDEX IF NOT EXISTS idx_snoozes_until ON email_snoozes(snooze_until);

-- Auto-delete schedules
CREATE TABLE IF NOT EXISTS email_auto_deletes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  delete_after TEXT NOT NULL,
  reason TEXT,  -- 2fa, promo, dev
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_deletes_after ON email_auto_deletes(delete_after);

-- Sent email tracking (for waiting-for-reply)
CREATE TABLE IF NOT EXISTS sent_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  thread_id TEXT,
  expecting_reply INTEGER NOT NULL DEFAULT 1,
  snooze_until TEXT,
  reply_received INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email_id)
);

CREATE INDEX IF NOT EXISTS idx_sent_tracking_expecting ON sent_tracking(expecting_reply, snooze_until);

-- Classification log (audit trail)
CREATE TABLE IF NOT EXISTS triage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  pattern_hint TEXT,
  llm_folder TEXT,
  llm_confidence REAL,
  pattern_agreed INTEGER,
  final_folder TEXT NOT NULL,
  source TEXT NOT NULL,  -- llm, pattern-fallback, sender_rule, user-override
  reasoning TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_triage_log_email ON triage_log(email_id);
CREATE INDEX IF NOT EXISTS idx_triage_log_created ON triage_log(created_at DESC);
