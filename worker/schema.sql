CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '🛒',
  image_data TEXT,
  image_mime_type TEXT,
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
  image_data TEXT,
  image_mime_type TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  stock_managed INTEGER NOT NULL DEFAULT 0 CHECK(stock_managed IN (0,1)),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_stock_threshold >= 0),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0 AND gst_rate_bps <= 4000),
  gst_rate_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_confirmed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS home_promotions (
  id TEXT PRIMARY KEY,
  image_data TEXT NOT NULL,
  image_mime_type TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 999,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  passcode_salt TEXT,
  passcode_hash TEXT,
  auth_version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
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
  deleted_at TEXT,
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
  scheduled_delivery_date TEXT,
  scheduled_slot_id TEXT,
  assigned_store_id TEXT,
  scheduled_start_minute INTEGER,
  scheduled_end_minute INTEGER,
  schedule_status TEXT NOT NULL DEFAULT 'unscheduled' CHECK(schedule_status IN ('unscheduled','requested','confirmed','change_requested','conflict','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_collected_at TEXT,
  client_order_id TEXT UNIQUE,
  is_test_order INTEGER NOT NULL DEFAULT 0 CHECK(is_test_order IN (0,1)),
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
  stock_reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK(stock_reserved_qty >= 0),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0 AND gst_rate_bps <= 4000),
  gst_rate_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_confirmed IN (0,1)),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_address_snapshots (
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
CREATE TABLE IF NOT EXISTS invoice_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  document_type TEXT NOT NULL DEFAULT 'commercial_invoice' CHECK(document_type IN ('commercial_invoice','gst_tax_invoice','bill_of_supply')),
  legal_name TEXT NOT NULL DEFAULT '',
  business_address TEXT NOT NULL DEFAULT '',
  state_name TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  series_prefix TEXT NOT NULL DEFAULT 'FW',
  footer TEXT NOT NULL DEFAULT '',
  prices_include_tax INTEGER NOT NULL DEFAULT 1 CHECK(prices_include_tax IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO invoice_settings (id,enabled,document_type,series_prefix,prices_include_tax)
VALUES (1,0,'commercial_invoice','FW',1);
CREATE TABLE IF NOT EXISTS invoice_sequences (
  financial_year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  document_type TEXT NOT NULL CHECK(document_type IN ('commercial_invoice','gst_tax_invoice','bill_of_supply')),
  financial_year TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  seller_snapshot TEXT NOT NULL,
  buyer_snapshot TEXT NOT NULL,
  totals_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0),
  gross_paise INTEGER NOT NULL CHECK(gross_paise >= 0),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0 AND gst_rate_bps <= 4000),
  taxable_paise INTEGER NOT NULL CHECK(taxable_paise >= 0),
  cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(cgst_paise >= 0),
  sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(sgst_paise >= 0),
  igst_paise INTEGER NOT NULL DEFAULT 0 CHECK(igst_paise >= 0),
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
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
CREATE TABLE IF NOT EXISTS owner_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key TEXT NOT NULL DEFAULT 'default',
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_owner_push_subscriptions_owner ON owner_push_subscriptions(owner_key);
CREATE TABLE IF NOT EXISTS notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL CHECK(audience IN ('customer','owner')),
  customer_id TEXT,
  order_id TEXT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_url TEXT NOT NULL DEFAULT '/',
  status TEXT NOT NULL DEFAULT 'pending',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notification_events_audience_id ON notification_events(audience,id DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_order_id ON notification_events(order_id,id DESC);
CREATE TABLE IF NOT EXISTS store_profile (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  store_name TEXT NOT NULL DEFAULT 'FreshWay',
  about TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  shop_latitude REAL,
  shop_longitude REAL,
  business_hours TEXT NOT NULL DEFAULT '',
  delivery_info TEXT NOT NULL DEFAULT '',
  share_title TEXT NOT NULL DEFAULT 'FreshWay | Fresh Groceries & Everyday Essentials Delivered Locally',
  share_description TEXT NOT NULL DEFAULT 'Shop fresh fruits, groceries and everyday essentials from FreshWay. Order online for local delivery with convenient cash payment.',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_home_promotions_active_order ON home_promotions(active, display_order, id);
CREATE INDEX IF NOT EXISTS idx_categories_active_order ON categories(active, display_order, name);
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, active, name);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock_managed,stock_quantity,active);
CREATE INDEX IF NOT EXISTS idx_order_items_stock_reserved ON order_items(product_id,stock_reserved_qty);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_phone_passcode ON customers(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_unique ON customers(phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(delivery_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_created ON orders(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_plan_status_created ON orders(delivery_plan, delivery_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_plan ON orders(delivery_plan, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_test_created ON orders(is_test_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_customer_default ON addresses(customer_id,is_default DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_customer_label ON addresses(customer_id,label);
CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_customer ON order_address_snapshots(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_address_snapshots_location ON order_address_snapshots(latitude,longitude);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_issued ON invoices(customer_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id,id);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_start);
INSERT OR IGNORE INTO store_profile (id) VALUES (1);
-- INSERT OR IGNORE INTO products is intentionally omitted: the V1 catalogue is admin-managed.
INSERT OR IGNORE INTO categories (id,name,slug,icon,description,display_order,active) VALUES
('cat-oils','Oils','oils','🫒','Cooking and everyday oils',1,1),
('cat-rice','Rice','rice','🍚','Rice and rice varieties',2,1);


-- Store requests separately; never cascade-delete orders and invoices during request submission.
CREATE TABLE IF NOT EXISTS account_deletion_requests (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, phone_snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','completed','rejected')), source TEXT NOT NULL CHECK(source IN ('authenticated_customer','external_verified_phone')), admin_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at TEXT);
CREATE TABLE IF NOT EXISTS account_deletion_summary (id INTEGER PRIMARY KEY CHECK(id=1), completed_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_count >= 0), latest_completed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status_created ON account_deletion_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_customer_created ON account_deletion_requests(customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_requests_one_active ON account_deletion_requests(customer_id) WHERE status IN ('pending','in_review');


CREATE TABLE IF NOT EXISTS delivery_scheduling_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  booking_horizon_days INTEGER NOT NULL DEFAULT 7 CHECK(booking_horizon_days BETWEEN 1 AND 60),
  same_day_cutoff_minutes INTEGER NOT NULL DEFAULT 120 CHECK(same_day_cutoff_minutes BETWEEN 0 AND 1440),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO delivery_scheduling_settings (id,enabled,booking_horizon_days,same_day_cutoff_minutes,timezone)
VALUES (1,0,7,120,'Asia/Kolkata');

CREATE TABLE IF NOT EXISTS delivery_stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  service_radius_km REAL NOT NULL DEFAULT 10 CHECK(service_radius_km BETWEEN 0.1 AND 100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Physical on-hand stock per store. Reservations are tracked separately so available
-- stock is on-hand less active reservations; orders still use products.stock_quantity
-- as the aggregate available-stock guard.
CREATE TABLE IF NOT EXISTS delivery_store_inventory (
  store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id,product_id)
);

CREATE TABLE IF NOT EXISTS delivery_slots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE RESTRICT,
  delivery_date TEXT NOT NULL CHECK(length(delivery_date)=10),
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 500),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(end_minute > start_minute),
  UNIQUE(store_id,delivery_date,start_minute,end_minute)
);

CREATE TABLE IF NOT EXISTS delivery_slot_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  slot_id TEXT NOT NULL REFERENCES delivery_slots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('reserved','conflict','released','completed')),
  owner_override INTEGER NOT NULL DEFAULT 0 CHECK(owner_override IN (0,1)),
  override_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_one_active_slot_per_order
  ON delivery_slot_reservations(order_id) WHERE status IN ('reserved','conflict');
CREATE INDEX IF NOT EXISTS idx_delivery_slot_reservations_slot_state
  ON delivery_slot_reservations(slot_id,status);

CREATE TABLE IF NOT EXISTS delivery_store_inventory_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK(qty > 0),
  status TEXT NOT NULL CHECK(status IN ('reserved','conflict','released','fulfilled')),
  owner_override INTEGER NOT NULL DEFAULT 0 CHECK(owner_override IN (0,1)),
  override_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_store_inventory_one_active
  ON delivery_store_inventory_reservations(order_id,product_id)
  WHERE status IN ('reserved','conflict');
CREATE INDEX IF NOT EXISTS idx_delivery_store_inventory_product_state
  ON delivery_store_inventory_reservations(store_id,product_id,status);

CREATE TABLE IF NOT EXISTS order_action_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK(request_type IN ('cancellation','reschedule','return','issue')),
  requested_slot_id TEXT REFERENCES delivery_slots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_action_one_pending_type
  ON order_action_requests(order_id,request_type) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_order_action_queue
  ON order_action_requests(status,created_at DESC);

CREATE TABLE IF NOT EXISTS order_audit_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('customer','owner','system')),
  actor_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_audit_timeline
  ON order_audit_events(order_id,created_at,id);

CREATE TABLE IF NOT EXISTS order_operational_flags (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  flag_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_operational_one_open_flag
  ON order_operational_flags(order_id,flag_type) WHERE status='open';
CREATE INDEX IF NOT EXISTS idx_order_operational_queue
  ON order_operational_flags(status,created_at DESC);

-- The trigger is the final concurrent-booking guard. A preflight availability read alone
-- cannot protect two simultaneous requests that select the last slot.
CREATE TRIGGER IF NOT EXISTS delivery_slot_capacity_before_insert
BEFORE INSERT ON delivery_slot_reservations
WHEN NEW.status='reserved' AND NEW.owner_override=0
BEGIN
  SELECT CASE WHEN COALESCE((SELECT is_active FROM delivery_slots WHERE id=NEW.slot_id),0)<>1
    THEN RAISE(ABORT,'DELIVERY_SLOT_CLOSED') END;
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM delivery_slot_reservations
      WHERE slot_id=NEW.slot_id AND status IN ('reserved','conflict'))
      >= COALESCE((SELECT capacity FROM delivery_slots WHERE id=NEW.slot_id),0)
    THEN RAISE(ABORT,'DELIVERY_SLOT_FULL') END;
END;

CREATE TRIGGER IF NOT EXISTS delivery_slot_capacity_before_update
BEFORE UPDATE OF slot_id,status ON delivery_slot_reservations
WHEN NEW.status='reserved' AND NEW.owner_override=0
BEGIN
  SELECT CASE WHEN COALESCE((SELECT is_active FROM delivery_slots WHERE id=NEW.slot_id),0)<>1
    THEN RAISE(ABORT,'DELIVERY_SLOT_CLOSED') END;
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM delivery_slot_reservations
      WHERE slot_id=NEW.slot_id AND status IN ('reserved','conflict') AND id<>OLD.id)
      >= COALESCE((SELECT capacity FROM delivery_slots WHERE id=NEW.slot_id),0)
    THEN RAISE(ABORT,'DELIVERY_SLOT_FULL') END;
END;

CREATE TRIGGER IF NOT EXISTS delivery_store_stock_before_insert
BEFORE INSERT ON delivery_store_inventory_reservations
WHEN NEW.status='reserved' AND NEW.owner_override=0
BEGIN
  SELECT CASE WHEN
    COALESCE((SELECT stock_quantity FROM delivery_store_inventory
      WHERE store_id=NEW.store_id AND product_id=NEW.product_id),0)
    - COALESCE((SELECT SUM(qty) FROM delivery_store_inventory_reservations
      WHERE store_id=NEW.store_id AND product_id=NEW.product_id AND status IN ('reserved','conflict')),0)
    < NEW.qty
    THEN RAISE(ABORT,'DELIVERY_STORE_STOCK_LOW') END;
END;

CREATE TRIGGER IF NOT EXISTS delivery_store_stock_before_update
BEFORE UPDATE OF store_id,product_id,qty,status ON delivery_store_inventory_reservations
WHEN NEW.status='reserved' AND NEW.owner_override=0
BEGIN
  SELECT CASE WHEN
    COALESCE((SELECT stock_quantity FROM delivery_store_inventory
      WHERE store_id=NEW.store_id AND product_id=NEW.product_id),0)
    - COALESCE((SELECT SUM(qty) FROM delivery_store_inventory_reservations
      WHERE store_id=NEW.store_id AND product_id=NEW.product_id AND status IN ('reserved','conflict') AND id<>OLD.id),0)
    < NEW.qty
    THEN RAISE(ABORT,'DELIVERY_STORE_STOCK_LOW') END;
END;
