-- Short-lived, single-use WhatsApp OTP challenges for passwordless customer auth.
CREATE TABLE IF NOT EXISTS customer_auth_otps (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_auth_otps_phone_created
  ON customer_auth_otps(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_auth_otps_expiry
  ON customer_auth_otps(expires_at);
