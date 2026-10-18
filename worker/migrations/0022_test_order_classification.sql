-- Preserve all existing order records while separating test data from live business data.
ALTER TABLE orders ADD COLUMN is_test_order INTEGER NOT NULL DEFAULT 0 CHECK(is_test_order IN (0,1));
CREATE INDEX IF NOT EXISTS idx_orders_test_created ON orders(is_test_order, created_at DESC);
