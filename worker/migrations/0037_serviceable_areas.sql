-- FreshWay serviceable areas. Additive only; existing orders and customer data remain untouched.
CREATE TABLE IF NOT EXISTS serviceability_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enforcement_mode TEXT NOT NULL DEFAULT 'off' CHECK(enforcement_mode IN ('off','shadow','enforced')),
  config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO serviceability_settings (id,enforcement_mode,config_version)
VALUES (1,'off',1);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer_label TEXT NOT NULL DEFAULT '',
  coverage_mode TEXT NOT NULL CHECK(coverage_mode IN ('pincode','polygon','hybrid')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','archived')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK(priority >= -10000 AND priority <= 10000),
  pin_codes_json TEXT NOT NULL DEFAULT '[]',
  polygon_geojson TEXT,
  allow_pin_fallback INTEGER NOT NULL DEFAULT 0 CHECK(allow_pin_fallback IN (0,1)),
  unavailable_message TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_status_priority
  ON delivery_zones(status,priority DESC,id ASC);

CREATE TABLE IF NOT EXISTS serviceability_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  zone_id TEXT,
  enforcement_mode TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_serviceability_audit_created
  ON serviceability_audit(created_at DESC,id DESC);

-- Immutable order-time decision. No FK to delivery_zones so zone archival/cleanup
-- cannot rewrite or invalidate historical order serviceability evidence.
CREATE TABLE IF NOT EXISTS order_serviceability_snapshots (
  order_id TEXT PRIMARY KEY,
  zone_id TEXT,
  zone_name TEXT NOT NULL DEFAULT '',
  enforcement_mode TEXT NOT NULL CHECK(enforcement_mode IN ('off','shadow','enforced')),
  serviceable INTEGER CHECK(serviceable IS NULL OR serviceable IN (0,1)),
  order_allowed INTEGER NOT NULL CHECK(order_allowed IN (0,1)),
  match_type TEXT NOT NULL DEFAULT 'not_checked',
  reason_code TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  checked_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
