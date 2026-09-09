CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '🛒',
  description TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 999,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  emoji TEXT NOT NULL DEFAULT '🛒',
  active INTEGER NOT NULL DEFAULT 1,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  house TEXT NOT NULL,
  area TEXT NOT NULL,
  city TEXT NOT NULL,
  pincode TEXT NOT NULL,
  landmark TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  label TEXT NOT NULL DEFAULT 'Other',
  recipient_name TEXT,
  delivery_phone TEXT,
  building TEXT,
  floor TEXT,
  street TEXT,
  locality TEXT,
  district TEXT,
  state TEXT,
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  location_source TEXT,
  place_id TEXT,
  location_updated_at TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  address_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  total INTEGER NOT NULL CHECK(total >= 0),
  payment_status TEXT NOT NULL DEFAULT 'Not Collected' CHECK(payment_status IN ('Not Collected','Collected','Refunded','Cancelled')),
  delivery_status TEXT NOT NULL DEFAULT 'New' CHECK(delivery_status IN ('New','Confirmed','Processing','Ready','Out for Delivery','Delivered','Cancelled')),
  delivery_plan TEXT NOT NULL DEFAULT 'Tomorrow' CHECK(delivery_plan IN ('Today','Tomorrow','Later','Unscheduled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_collected_at TEXT,
  client_order_id TEXT UNIQUE,
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY(address_id) REFERENCES addresses(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  price INTEGER NOT NULL CHECK(price >= 0),
  line_total INTEGER NOT NULL CHECK(line_total >= 0),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
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
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  title TEXT,
  body TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_categories_active_order ON categories(active, display_order, name);
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, active, name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(delivery_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_plan ON orders(delivery_plan, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_customer_default ON addresses(customer_id,is_default DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_customer_label ON addresses(customer_id,label);
CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_location ON order_address_snapshots(latitude,longitude);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_start);
-- INSERT OR IGNORE INTO products is intentionally omitted: the V1 catalogue is admin-managed.
INSERT OR IGNORE INTO categories (id,name,slug,icon,description,display_order,active) VALUES
('cat-oils','Oils','oils','🫒','Cooking and everyday oils',1,1),
('cat-rice','Rice','rice','🍚','Rice and rice varieties',2,1);
