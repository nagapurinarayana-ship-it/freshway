PRAGMA foreign_keys=OFF;

ALTER TABLE addresses ADD COLUMN label TEXT NOT NULL DEFAULT 'Other';
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
ALTER TABLE addresses ADD COLUMN place_id TEXT;
ALTER TABLE addresses ADD COLUMN location_updated_at TEXT;
ALTER TABLE addresses ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_addresses_customer_default ON addresses(customer_id,is_default DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_customer_label ON addresses(customer_id,label);

CREATE TABLE IF NOT EXISTS order_address_snapshots (
  order_id TEXT PRIMARY KEY,
  recipient_name TEXT NOT NULL,
  delivery_phone TEXT NOT NULL,
  house_flat TEXT NOT NULL,
  building TEXT,
  floor TEXT,
  street TEXT,
  area TEXT NOT NULL,
  locality TEXT,
  city TEXT NOT NULL,
  district TEXT,
  state TEXT,
  pincode TEXT NOT NULL,
  landmark TEXT,
  delivery_note TEXT,
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  location_source TEXT,
  place_id TEXT,
  location_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_location ON order_address_snapshots(latitude,longitude);

PRAGMA foreign_keys=ON;
