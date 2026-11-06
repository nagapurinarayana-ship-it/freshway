-- Remove only the 12 legacy unassigned test orders explicitly confirmed by the owner.
-- These predate the is_test_order classification and therefore have is_test_order=0.
-- Keep customer accounts and saved addresses; remove the order and its order-linked
-- operational, notification, coupon and invoice data. Restore legacy aggregate stock
-- reservations exactly as the normal Owner cancellation path does for unassigned orders.
--
-- This migration intentionally fails closed if any target has disappeared, been assigned,
-- become Delivered/Cancelled, is no longer old, or no longer matches the audited live-order
-- classification. Do not broaden this whitelist.

CREATE TABLE _freshway_legacy_unassigned_test_orders_0050 (
  id TEXT PRIMARY KEY
);

INSERT INTO _freshway_legacy_unassigned_test_orders_0050 (id) VALUES
  ('FW-12031400-6NE'),
  ('FW-53962202-NM5'),
  ('FW-53402034-XBH'),
  ('FW-31938520-0L7'),
  ('FW-87828109-18W'),
  ('FW-67922479-XYN'),
  ('FW-08623690-412'),
  ('FW-57069654-MR4'),
  ('FW-35019352-MJ4'),
  ('FW-78689788-FCD'),
  ('FW-77588644-BHS'),
  ('FW-70361915-UDE');

CREATE TABLE _freshway_legacy_cleanup_guard_0050 (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _freshway_legacy_cleanup_guard_0050 (valid)
SELECT CASE
  WHEN COUNT(o.id) = 12
   AND SUM(CASE WHEN o.assigned_store_id IS NULL THEN 1 ELSE 0 END) = 12
   AND SUM(CASE WHEN o.is_test_order = 0 THEN 1 ELSE 0 END) = 12
   AND SUM(CASE WHEN o.created_at < '2026-11-03' THEN 1 ELSE 0 END) = 12
   AND SUM(CASE WHEN o.delivery_status NOT IN ('Delivered','Cancelled') THEN 1 ELSE 0 END) = 12
  THEN 1 ELSE 0
END
FROM _freshway_legacy_unassigned_test_orders_0050 target
LEFT JOIN orders o ON o.id = target.id;

DROP TABLE _freshway_legacy_cleanup_guard_0050;

-- Restore stock_reserved_qty for legacy unassigned orders before removing order_items.
-- This mirrors the existing Owner cancellation path for orders without a store assignment.
UPDATE products
SET stock_quantity = stock_quantity + (
      SELECT COALESCE(SUM(oi.stock_reserved_qty), 0)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050)
        AND oi.product_id = products.id
        AND o.assigned_store_id IS NULL
        AND o.delivery_status NOT IN ('Delivered','Cancelled')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT DISTINCT oi.product_id
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050)
    AND oi.stock_reserved_qty > 0
    AND o.assigned_store_id IS NULL
    AND o.delivery_status NOT IN ('Delivered','Cancelled')
);

-- Order-linked customer and Owner alert delivery records.
DELETE FROM notification_events
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

-- Release first-order claims and coupon usage associated only with these test orders.
DELETE FROM coupon_redemptions
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

DELETE FROM first_order_coupon_claims
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

-- Remove issued test receipt documents and their item rows before deleting orders.
DELETE FROM invoice_items
WHERE invoice_id IN (
  SELECT id FROM invoices
  WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050)
);

DELETE FROM invoices
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

-- Remove requests, delivery reservations and operational audit links before parent orders.
DELETE FROM order_action_requests
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

DELETE FROM delivery_slot_reservations
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

DELETE FROM delivery_store_inventory_reservations
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

DELETE FROM order_audit_events
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

DELETE FROM order_operational_flags
WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

-- order_items and order_address_snapshots are removed by their ON DELETE CASCADE rules.
DELETE FROM orders
WHERE id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050);

-- Fail the migration rather than leave any target order or child row behind.
CREATE TABLE _freshway_legacy_cleanup_verify_0050 (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _freshway_legacy_cleanup_verify_0050 (valid)
SELECT CASE WHEN
  NOT EXISTS (SELECT 1 FROM orders WHERE id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM notification_events WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM coupon_redemptions WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM first_order_coupon_claims WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM invoices WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM order_action_requests WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM delivery_slot_reservations WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM delivery_store_inventory_reservations WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM order_audit_events WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM order_operational_flags WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM order_address_snapshots WHERE order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  AND NOT EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_id IN (SELECT id FROM _freshway_legacy_unassigned_test_orders_0050))
  THEN 1 ELSE 0
END;

DROP TABLE _freshway_legacy_cleanup_verify_0050;
DROP TABLE _freshway_legacy_unassigned_test_orders_0050;
