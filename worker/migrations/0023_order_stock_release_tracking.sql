-- Make cancellation stock restoration idempotent under concurrent Owner requests.
-- Existing orders keep NULL markers; this migration does not alter order status, payment, or stock.
ALTER TABLE orders ADD COLUMN stock_release_token TEXT;
ALTER TABLE orders ADD COLUMN stock_released_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stock_release_token ON orders(stock_release_token) WHERE stock_release_token IS NOT NULL;
