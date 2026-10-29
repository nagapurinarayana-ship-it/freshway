-- Separate checkout-only address rows from customer-owned reusable address-book entries.
-- Keep these rows in addresses because existing orders reference address_id. Detailed,
-- immutable delivery information remains in order_address_snapshots.
ALTER TABLE addresses ADD COLUMN is_saved_address INTEGER NOT NULL DEFAULT 1 CHECK(is_saved_address IN (0,1));

-- Before this distinction existed, checkout inserted minimal address rows with neither
-- recipient nor delivery mobile. They are order records, not reusable saved addresses.
UPDATE addresses
SET is_saved_address=0, is_default=0
WHERE recipient_name IS NULL OR TRIM(recipient_name)='' OR delivery_phone IS NULL OR TRIM(delivery_phone)='';

CREATE INDEX IF NOT EXISTS idx_addresses_customer_saved_default
  ON addresses(customer_id,is_saved_address,is_default DESC,id DESC);
