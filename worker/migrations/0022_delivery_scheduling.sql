-- Concrete delivery scheduling, customer order actions and Owner operational controls.
-- Safe for an existing production D1 database: one numbered migration, no order deletion.
ALTER TABLE orders ADD COLUMN scheduled_delivery_date TEXT;
ALTER TABLE orders ADD COLUMN scheduled_slot_id TEXT;
ALTER TABLE orders ADD COLUMN assigned_store_id TEXT;
ALTER TABLE orders ADD COLUMN scheduled_start_minute INTEGER;
ALTER TABLE orders ADD COLUMN scheduled_end_minute INTEGER;
ALTER TABLE orders ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'unscheduled'
  CHECK(schedule_status IN ('unscheduled','requested','confirmed','change_requested','conflict','completed','cancelled'));

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
