ALTER TABLE orders ADD COLUMN delivery_plan TEXT NOT NULL DEFAULT 'Tomorrow' CHECK(delivery_plan IN ('Today','Tomorrow','Later','Unscheduled'));
CREATE INDEX IF NOT EXISTS idx_orders_plan ON orders(delivery_plan, created_at DESC);
