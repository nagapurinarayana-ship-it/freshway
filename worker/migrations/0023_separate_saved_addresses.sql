-- Separate customer-managed addresses from one-off address rows attached to orders.
-- Existing order addresses remain available to order history and delivery operations,
-- but are excluded from the customer's saved-address book.
ALTER TABLE addresses ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 1 CHECK(is_saved IN (0,1));

UPDATE addresses
SET is_saved=0, is_default=0
WHERE EXISTS (SELECT 1 FROM orders WHERE orders.address_id=addresses.id);

UPDATE addresses
SET is_default=0
WHERE is_saved=1 AND deleted_at IS NOT NULL;

-- Keep at most one active default per customer, preserving the newest existing default.
UPDATE addresses
SET is_default=0
WHERE is_saved=1 AND deleted_at IS NULL AND is_default=1
  AND id NOT IN (
    SELECT MAX(id)
    FROM addresses
    WHERE is_saved=1 AND deleted_at IS NULL AND is_default=1
    GROUP BY customer_id
  );

-- Customers with saved addresses but no current default receive the most recently saved address as default.
UPDATE addresses
SET is_default=1
WHERE is_saved=1 AND deleted_at IS NULL
  AND id=(SELECT MAX(candidate.id) FROM addresses candidate
          WHERE candidate.customer_id=addresses.customer_id
            AND candidate.is_saved=1 AND candidate.deleted_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM addresses active
    WHERE active.customer_id=addresses.customer_id
      AND active.is_saved=1 AND active.deleted_at IS NULL AND active.is_default=1
  );

CREATE INDEX IF NOT EXISTS idx_addresses_saved_list
  ON addresses(customer_id,is_saved,deleted_at,is_default,id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_active_default
  ON addresses(customer_id)
  WHERE is_saved=1 AND deleted_at IS NULL AND is_default=1;
