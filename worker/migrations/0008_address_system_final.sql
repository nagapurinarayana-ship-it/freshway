PRAGMA foreign_keys=OFF;

ALTER TABLE addresses ADD COLUMN label TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE addresses ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE addresses ADD COLUMN recipient_name TEXT;
ALTER TABLE addresses ADD COLUMN delivery_phone TEXT;
ALTER TABLE addresses ADD COLUMN building TEXT;
ALTER TABLE addresses ADD COLUMN floor TEXT;
ALTER TABLE addresses ADD COLUMN street TEXT;
ALTER TABLE addresses ADD COLUMN locality TEXT;
ALTER TABLE addresses ADD COLUMN district TEXT;
ALTER TABLE addresses ADD COLUMN state TEXT;
ALTER TABLE addresses ADD COLUMN latitude REAL;
ALTER TABLE addresses ADD COLUMN longitude REAL;
ALTER TABLE addresses ADD COLUMN accuracy_meters REAL;
ALTER TABLE addresses ADD COLUMN location_source TEXT;
ALTER TABLE addresses ADD COLUMN location_updated_at TEXT;
ALTER TABLE addresses ADD COLUMN place_name TEXT;
ALTER TABLE addresses ADD COLUMN place_id TEXT;

CREATE INDEX IF NOT EXISTS idx_addresses_customer_default ON addresses(customer_id,is_default,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_coordinates ON addresses(latitude,longitude);

CREATE TABLE IF NOT EXISTS order_address_snapshots (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_customer ON order_address_snapshots(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_coordinates ON order_address_snapshots(latitude,longitude);

PRAGMA foreign_keys=ON;
