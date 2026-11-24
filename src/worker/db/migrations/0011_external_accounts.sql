-- External mail accounts pulled into OpenInbox by the Worker (POP3/IMAP).
-- One row per remote account: the Worker connects on the 10-minute cron (and on
-- demand from the admin UI) and ingests new messages into the target mailbox.
-- Seen state is the remote UIDL/UID set; ingest's message-id dedupe is the backstop.
-- `max_import` caps the total messages pulled for the account (0 = unlimited):
-- the fetch stops once `imported_count` reaches it, so a large backfill cannot
-- fill D1. Default 5000: a mailbox of ~1000 messages backfills fully and keeps
-- room for new mail.
CREATE TABLE IF NOT EXISTS external_accounts (
  id INTEGER PRIMARY KEY,
  protocol TEXT NOT NULL DEFAULT 'pop3' CHECK (protocol IN ('pop3', 'imap')),
  name TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  security TEXT NOT NULL DEFAULT 'tls' CHECK (security IN ('tls', 'starttls', 'plain')),
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL DEFAULT '',
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes (id) ON DELETE CASCADE,
  folder TEXT NOT NULL DEFAULT 'INBOX',
  delete_after_fetch INTEGER NOT NULL DEFAULT 0,
  mark_seen INTEGER NOT NULL DEFAULT 0,
  max_import INTEGER NOT NULL DEFAULT 5000,
  enabled INTEGER NOT NULL DEFAULT 1,
  seen_uids TEXT NOT NULL DEFAULT '[]',
  uidvalidity INTEGER,
  imported_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at INTEGER,
  last_fetched_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS external_accounts_enabled ON external_accounts (enabled);
