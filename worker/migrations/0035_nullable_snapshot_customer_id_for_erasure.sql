-- The production legacy table was created with customer_id NOT NULL, while account
-- erasure must remove the operational link to the customer. Rebuild this table
-- with the canonical nullable customer_id definition, preserving order snapshots
-- and both existing foreign-key behaviours.
CREATE TABLE order_address_snapshots_erasure_safe (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT,
  address_id INTEGER,
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
  place_name TEXT,
  place_id TEXT,
  location_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(address_id) REFERENCES addresses(id) ON DELETE SET NULL
);

-- Existing production rows were checked before this migration. COALESCE only
-- supplies safe placeholders for any legacy NULL values that violate the
-- canonical NOT NULL requirements; non-NULL snapshot values are preserved.
INSERT INTO order_address_snapshots_erasure_safe (
  order_id,customer_id,address_id,recipient_name,delivery_phone,house_flat,
  building,floor,street,area,locality,city,district,state,pincode,landmark,
  delivery_note,latitude,longitude,accuracy_meters,location_source,place_name,
  place_id,location_updated_at,created_at
)
SELECT
  order_id,customer_id,address_id,
  COALESCE(recipient_name,'Deleted customer'),
  COALESCE(delivery_phone,''),
  COALESCE(house_flat,'Removed'),
  building,floor,street,
  COALESCE(area,'Removed'),
  locality,
  COALESCE(city,'Removed'),
  district,state,
  COALESCE(pincode,'000000'),
  landmark,delivery_note,latitude,longitude,accuracy_meters,location_source,
  place_name,place_id,location_updated_at,COALESCE(created_at,CURRENT_TIMESTAMP)
FROM order_address_snapshots;

DROP TABLE order_address_snapshots;
ALTER TABLE order_address_snapshots_erasure_safe RENAME TO order_address_snapshots;

CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_customer
  ON order_address_snapshots(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_coordinates
  ON order_address_snapshots(latitude,longitude);
