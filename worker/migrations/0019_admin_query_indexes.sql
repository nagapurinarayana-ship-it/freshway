CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_created ON orders(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_plan_status_created ON orders(delivery_plan, delivery_status, created_at DESC);
