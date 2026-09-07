-- Final address system is represented in the canonical schema.sql.
-- This migration is intentionally idempotent for databases whose baseline
-- schema already contains the final address columns/table. Live legacy D1
-- instances can be upgraded with the equivalent ALTER/CREATE statements once.

CREATE INDEX IF NOT EXISTS idx_addresses_customer_default
  ON addresses(customer_id,is_default,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_addresses_coordinates
  ON addresses(latitude,longitude);

CREATE TABLE IF NOT EXISTS order_address_snapshots (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT,
  address_id INTEGER,
  recipient_name TEXT,
  delivery_phone TEXT,
  house_flat TEXT,
  building TEXT,
  floor TEXT,
  street TEXT,
  area TEXT,
  locality TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  pincode TEXT,
  landmark TEXT,
  delivery_note TEXT,
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  location_source TEXT,
  location_updated_at TEXT,
  place_name TEXT,
  place_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(address_id) REFERENCES addresses(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_customer
  ON order_address_snapshots(customer_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_coordinates
  ON order_address_snapshots(latitude,longitude);
