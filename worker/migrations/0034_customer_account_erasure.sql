-- Tombstone support for completed account-deletion requests.
-- Keep customer IDs referenced by historical order/invoice records while disabling account access.
ALTER TABLE customers ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_active_phone
  ON customers(phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> '';
