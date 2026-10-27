-- Delivery pricing and fixed-amount coupon support.
-- Existing order totals are preserved; historical fee/discount details remain unknown and are recorded as zero.
CREATE TABLE IF NOT EXISTS delivery_offer_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  free_delivery_enabled INTEGER NOT NULL DEFAULT 1 CHECK (free_delivery_enabled IN (0,1)),
  free_delivery_threshold INTEGER NOT NULL DEFAULT 800 CHECK (free_delivery_threshold >= 0),
  standard_delivery_fee INTEGER NOT NULL DEFAULT 30 CHECK (standard_delivery_fee >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO delivery_offer_settings(id,free_delivery_enabled,free_delivery_threshold,standard_delivery_fee)
VALUES(1,1,800,30);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title TEXT NOT NULL,
  discount_amount INTEGER NOT NULL CHECK(discount_amount > 0),
  first_order_only INTEGER NOT NULL DEFAULT 0 CHECK(first_order_only IN (0,1)),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  max_redemptions INTEGER CHECK(max_redemptions IS NULL OR max_redemptions > 0),
  per_customer_limit INTEGER CHECK(per_customer_limit IS NULL OR per_customer_limit > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_coupons_active_dates ON coupons(active,starts_on,ends_on);
CREATE INDEX IF NOT EXISTS idx_coupons_created ON coupons(created_at DESC);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY NOT NULL,
  coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  code_snapshot TEXT NOT NULL,
  discount_amount INTEGER NOT NULL CHECK(discount_amount >= 0),
  first_order_only INTEGER NOT NULL DEFAULT 0 CHECK(first_order_only IN (0,1)),
  status TEXT NOT NULL DEFAULT 'redeemed' CHECK(status IN ('redeemed','released')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_status ON coupon_redemptions(coupon_id,status);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer_coupon ON coupon_redemptions(customer_id,coupon_id,status);

CREATE TABLE IF NOT EXISTS first_order_coupon_claims (
  customer_id TEXT PRIMARY KEY NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders ADD COLUMN items_subtotal INTEGER NOT NULL DEFAULT 0 CHECK(items_subtotal >= 0);
ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK(delivery_fee >= 0);
ALTER TABLE orders ADD COLUMN coupon_id TEXT REFERENCES coupons(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0 CHECK(coupon_discount >= 0);
UPDATE orders SET items_subtotal=total WHERE items_subtotal=0;

CREATE TRIGGER IF NOT EXISTS coupon_redemption_guard_before_insert
BEFORE INSERT ON coupon_redemptions
WHEN NEW.status='redeemed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM coupons c WHERE c.id=NEW.coupon_id AND c.active=1
      AND c.code=NEW.code_snapshot COLLATE NOCASE
      AND c.discount_amount=NEW.discount_amount
      AND c.first_order_only=NEW.first_order_only
      AND c.starts_on <= strftime('%Y-%m-%d','now','+5 hours','+30 minutes')
      AND (c.ends_on IS NULL OR c.ends_on >= strftime('%Y-%m-%d','now','+5 hours','+30 minutes'))
  ) THEN RAISE(ABORT,'COUPON_CHANGED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM coupons c WHERE c.id=NEW.coupon_id AND c.max_redemptions IS NOT NULL
      AND (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.status='redeemed') >= c.max_redemptions
  ) THEN RAISE(ABORT,'COUPON_MAX_REDEMPTIONS_REACHED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM coupons c WHERE c.id=NEW.coupon_id AND c.per_customer_limit IS NOT NULL
      AND (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.customer_id=NEW.customer_id AND r.status='redeemed') >= c.per_customer_limit
  ) THEN RAISE(ABORT,'COUPON_CUSTOMER_LIMIT_REACHED') END;
  SELECT CASE WHEN NEW.first_order_only=1 AND (
    EXISTS(SELECT 1 FROM first_order_coupon_claims f WHERE f.customer_id=NEW.customer_id)
    OR EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=NEW.customer_id AND o.id<>NEW.order_id AND o.is_test_order=0)
  ) THEN RAISE(ABORT,'COUPON_FIRST_ORDER_ONLY') END;
END;
