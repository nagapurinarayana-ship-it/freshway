-- FreshWay inventory controls.
-- Existing products keep current ordering behavior until the owner enables stock tracking.
ALTER TABLE products ADD COLUMN stock_managed INTEGER NOT NULL DEFAULT 0 CHECK(stock_managed IN (0,1));
ALTER TABLE products ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0);
ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_stock_threshold >= 0);
ALTER TABLE order_items ADD COLUMN stock_reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK(stock_reserved_qty >= 0);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock_managed,stock_quantity,active);
CREATE INDEX IF NOT EXISTS idx_order_items_stock_reserved ON order_items(product_id,stock_reserved_qty);
