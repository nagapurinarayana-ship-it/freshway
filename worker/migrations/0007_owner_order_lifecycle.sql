PRAGMA foreign_keys=OFF;

CREATE TABLE orders_lifecycle (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  address_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  total INTEGER NOT NULL CHECK(total >= 0),
  payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK(payment_status IN ('Pending','Collected')),
  delivery_status TEXT NOT NULL DEFAULT 'New' CHECK(delivery_status IN ('New','Confirmed','Processing','Ready','Out for Delivery','Delivered','Cancelled')),
  delivery_plan TEXT NOT NULL DEFAULT 'Tomorrow' CHECK(delivery_plan IN ('Today','Tomorrow','Later','Unscheduled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_collected_at TEXT,
  client_order_id TEXT UNIQUE,
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY(address_id) REFERENCES addresses(id) ON DELETE RESTRICT
);

INSERT INTO orders_lifecycle
(id,customer_id,address_id,customer_name,customer_phone,total,payment_status,delivery_status,delivery_plan,created_at,updated_at,payment_collected_at,client_order_id)
SELECT id,customer_id,address_id,customer_name,customer_phone,total,payment_status,
  CASE delivery_status WHEN 'Ordered' THEN 'New' ELSE delivery_status END,
  delivery_plan,created_at,updated_at,payment_collected_at,client_order_id
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_lifecycle RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(delivery_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_plan ON orders(delivery_plan, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_payment_plan_created ON orders(delivery_status,payment_status,delivery_plan,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_name ON orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);

PRAGMA foreign_keys=ON;
