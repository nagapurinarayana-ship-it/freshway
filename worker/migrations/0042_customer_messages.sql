-- Customer support inbox and replies.
-- Messages are bound to the authenticated customer identity, expire automatically,
-- and are capped so support traffic cannot grow without limit.
CREATE TABLE IF NOT EXISTS customer_messages (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Customer',
  customer_phone_last4 TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','replied')),
  admin_reply TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  replied_at TEXT,
  reply_seen_at TEXT,
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+90 days'))
);

CREATE INDEX IF NOT EXISTS idx_customer_messages_customer_created
  ON customer_messages(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_messages_status_created
  ON customer_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_messages_expires
  ON customer_messages(expires_at);
