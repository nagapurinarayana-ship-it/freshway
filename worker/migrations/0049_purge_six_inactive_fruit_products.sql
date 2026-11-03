-- Permanently remove the six explicitly retired inactive fruit products.
-- Delete every whole order containing one of them, including mixed baskets, and all
-- attached invoices, delivery/coupon actions, reservations, notifications and audit rows.
-- Oil and Rice category products/settings are intentionally excluded from the product purge.
-- Completed deliveries do not get stock credited back; only still-unfulfilled legacy
-- (non-store-assigned) reservations are restored before their orders are erased.

CREATE TABLE IF NOT EXISTS fw_purge_20261103_products (product_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS fw_purge_20261103_orders (order_id TEXT PRIMARY KEY);

DELETE FROM fw_purge_20261103_products;
DELETE FROM fw_purge_20261103_orders;

INSERT OR IGNORE INTO fw_purge_20261103_products (product_id)
SELECT p.id
FROM products p
LEFT JOIN categories c ON c.id=p.category_id
WHERE p.active=0
  AND LOWER(TRIM(p.name)) IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')
  AND COALESCE(p.category_id,'') NOT IN ('cat-oils','cat-rice')
  AND LOWER(TRIM(COALESCE(c.name,''))) NOT IN ('oil','oils','rice')
  AND LOWER(TRIM(COALESCE(c.slug,''))) NOT IN ('oil','oils','rice');

-- Include an order if its original line items, store reservations, or invoice snapshot
-- references one of the retired products. This also captures any inconsistent legacy
-- order where one of those copies is missing.
INSERT OR IGNORE INTO fw_purge_20261103_orders (order_id)
SELECT oi.order_id
FROM order_items oi
JOIN fw_purge_20261103_products p ON p.product_id=oi.product_id
UNION
SELECT r.order_id
FROM delivery_store_inventory_reservations r
JOIN fw_purge_20261103_products p ON p.product_id=r.product_id
UNION
SELECT i.order_id
FROM invoices i
JOIN invoice_items ii ON ii.invoice_id=i.id
JOIN fw_purge_20261103_products p ON p.product_id=ii.product_id;

-- Return legacy aggregate stock reservations for orders that have not been delivered
-- or cancelled. Store-level stock is released by deleting the order's active reservation
-- rows below; fulfilled store stock remains consumed.
UPDATE products
SET stock_quantity = stock_quantity + COALESCE((
  SELECT SUM(oi.stock_reserved_qty)
  FROM order_items oi
  JOIN orders o ON o.id=oi.order_id
  JOIN fw_purge_20261103_orders doomed ON doomed.order_id=o.id
  WHERE oi.product_id=products.id
    AND oi.stock_reserved_qty>0
    AND o.assigned_store_id IS NULL
    AND LOWER(COALESCE(o.delivery_status,'')) NOT IN ('delivered','cancelled')
),0),
updated_at=CURRENT_TIMESTAMP
WHERE stock_managed=1
  AND EXISTS (
    SELECT 1
    FROM order_items oi
    JOIN fw_purge_20261103_orders doomed ON doomed.order_id=oi.order_id
    WHERE oi.product_id=products.id AND oi.stock_reserved_qty>0
  );

-- Remove every invoice line and invoice attached to the affected whole orders.
DELETE FROM invoice_items
WHERE invoice_id IN (
  SELECT i.id FROM invoices i
  JOIN fw_purge_20261103_orders doomed ON doomed.order_id=i.order_id
);
DELETE FROM invoices
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);

-- Remove order-scoped records that intentionally use RESTRICT or no foreign key.
DELETE FROM coupon_redemptions
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM first_order_coupon_claims
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM delivery_store_inventory_reservations
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM delivery_slot_reservations
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM order_action_requests
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM order_audit_events
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM order_operational_flags
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM notification_events
WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);

-- Orders cascade-delete their order_items and address snapshots.
DELETE FROM orders
WHERE id IN (SELECT order_id FROM fw_purge_20261103_orders);

-- Remove per-store stock rows before deleting products (the inventory FK is RESTRICT).
DELETE FROM delivery_store_inventory
WHERE product_id IN (SELECT product_id FROM fw_purge_20261103_products);

-- delivery_store_catalogue rows cascade with the product; all other product settings,
-- including Oil and Rice products, remain unchanged.
DELETE FROM products
WHERE id IN (SELECT product_id FROM fw_purge_20261103_products);

DROP TABLE fw_purge_20261103_orders;
DROP TABLE fw_purge_20261103_products;
