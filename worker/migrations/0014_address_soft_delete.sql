-- Keep address rows referenced by orders while removing them from active saved-address lists.
ALTER TABLE addresses ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_addresses_customer_deleted ON addresses(customer_id,deleted_at,is_default,id);
