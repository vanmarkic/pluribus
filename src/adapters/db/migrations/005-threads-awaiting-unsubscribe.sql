-- Migration: Add threading, awaiting reply, and unsubscribe columns
-- Version: 005

-- Threading columns
ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
ALTER TABLE emails ADD COLUMN "references" TEXT;
ALTER TABLE emails ADD COLUMN thread_id TEXT;

-- Awaiting reply columns
ALTER TABLE emails ADD COLUMN awaiting_reply INTEGER DEFAULT 0;
ALTER TABLE emails ADD COLUMN awaiting_reply_since TEXT;

-- Unsubscribe columns
ALTER TABLE emails ADD COLUMN list_unsubscribe TEXT;
ALTER TABLE emails ADD COLUMN list_unsubscribe_post TEXT;

-- Thread index for grouping
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id, date DESC);

-- Awaiting reply index
CREATE INDEX IF NOT EXISTS idx_emails_awaiting ON emails(account_id, awaiting_reply)
  WHERE awaiting_reply = 1;

-- Unsubscribe index (only emails with unsubscribe option)
CREATE INDEX IF NOT EXISTS idx_emails_unsubscribe ON emails(id)
  WHERE list_unsubscribe IS NOT NULL;
