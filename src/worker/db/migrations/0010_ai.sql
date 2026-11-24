-- AI features ported from CunInbox (cunzhangcrypto/CunInbox, MIT): mail classification,
-- digital-identity discovery, daily digests and the security center.
--
-- Design notes (OpenInbox adaptation):
-- * email_analysis and security_events are scoped by mailbox (mailboxes can have several
--   members), not by user: visibility is decided by mailbox membership, the same rule the
--   rest of OpenInbox uses for reading mail.
-- * identities and daily_digests are scoped by user: an identity only exists once its owner
--   confirms it, and a digest is generated per user from the mailboxes they can read.
-- * CunInbox's separate `platform` table is not ported: platform name/domain/category are
--   stored inline on the analysis and identity rows.
-- * No KV/R2 binding is needed for these tables. Attachments still use OpenInbox's existing
--   optional R2-over-S3 setup, and AI inference uses the optional Workers AI binding (or an
--   OpenAI-compatible API key stored encrypted in settings).
CREATE TABLE IF NOT EXISTS email_analysis (
  id INTEGER PRIMARY KEY,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes (id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('', 'register', 'verify', 'security', 'bill', 'update', 'marketing', 'social')),
  summary TEXT NOT NULL DEFAULT '',
  key_info TEXT NOT NULL DEFAULT '{}',
  platform_name TEXT NOT NULL DEFAULT '',
  platform_domain TEXT NOT NULL DEFAULT '',
  platform_category TEXT NOT NULL DEFAULT '' CHECK (platform_category IN ('', 'dev', 'ai', 'saas', 'social', 'cloud', 'web3', 'finance', 'shop', 'news', 'other')),
  identity_id INTEGER,
  is_new_identity INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (mailbox_id, message_id)
);
CREATE INDEX IF NOT EXISTS email_analysis_mailbox ON email_analysis (mailbox_id, created_at);
CREATE INDEX IF NOT EXISTS email_analysis_new_identity ON email_analysis (is_new_identity, created_at);

CREATE TABLE IF NOT EXISTS identities (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform_name TEXT NOT NULL DEFAULT '',
  platform_domain TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('dev', 'ai', 'saas', 'social', 'cloud', 'web3', 'finance', 'shop', 'news', 'other')),
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2)),
  identity_email TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  last_active_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id, created_at);
CREATE INDEX IF NOT EXISTS identities_platform ON identities (platform_domain, identity_email);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes (id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  identity_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('password_change', 'abnormal_login', 'data_breach')),
  risk_level INTEGER NOT NULL DEFAULT 0 CHECK (risk_level IN (0, 1, 2)),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  suggestion TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2, 3)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS security_events_mailbox ON security_events (mailbox_id, created_at);
CREATE INDEX IF NOT EXISTS security_events_unprocessed ON security_events (status, risk_level);

CREATE TABLE IF NOT EXISTS daily_digests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  digest_date TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  important_count INTEGER NOT NULL DEFAULT 0,
  email_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, digest_date)
);
CREATE INDEX IF NOT EXISTS daily_digests_user ON daily_digests (user_id, digest_date);
