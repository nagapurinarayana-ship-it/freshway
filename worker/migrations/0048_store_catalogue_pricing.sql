-- Independent per-store catalogue visibility and selling prices.
-- Existing stores inherit the central catalogue (visible, central price) without
-- changing inventory, historical order snapshots, or invoice records.
CREATE TABLE IF NOT EXISTS delivery_store_catalogue (
  store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0,1)),
  price_override INTEGER CHECK(price_override IS NULL OR price_override >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_store_catalogue_visible
  ON delivery_store_catalogue(store_id, is_available, product_id);

INSERT OR IGNORE INTO delivery_store_catalogue (store_id,product_id,is_available,price_override)
SELECT s.id,p.id,1,NULL
FROM delivery_stores s CROSS JOIN products p;
