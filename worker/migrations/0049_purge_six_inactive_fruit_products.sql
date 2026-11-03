-- Permanently remove the six retired fruit products and any whole order that
-- contains one. Oil and Rice products/categories are explicitly protected.
CREATE TABLE IF NOT EXISTS fw_purge_20261103_products (product_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS fw_purge_20261103_orders (order_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS fw_purge_20261103_store_stock_products (product_id TEXT PRIMARY KEY);

DELETE FROM fw_purge_20261103_products;
DELETE FROM fw_purge_20261103_orders;
DELETE FROM fw_purge_20261103_store_stock_products;

INSERT OR IGNORE INTO fw_purge_20261103_products
SELECT p.id FROM products p LEFT JOIN categories c ON c.id=p.category_id
WHERE LOWER(TRIM(p.name)) IN ('mango','orange','papaya','pineapple','pomegranate','watermelon')
AND COALESCE(p.category_id,'') NOT IN ('cat-oils','cat-rice')
AND LOWER(TRIM(COALESCE(c.name,''))) NOT IN ('oil','oils','rice')
AND LOWER(TRIM(COALESCE(c.slug,''))) NOT IN ('oil','oils','rice');

INSERT OR IGNORE INTO fw_purge_20261103_orders
SELECT oi.order_id FROM order_items oi JOIN fw_purge_20261103_products p ON p.product_id=oi.product_id
UNION
SELECT r.order_id FROM delivery_store_inventory_reservations r JOIN fw_purge_20261103_products p ON p.product_id=r.product_id
UNION
SELECT i.order_id FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id
JOIN fw_purge_20261103_products p ON p.product_id=ii.product_id;

-- Remember active stock-managed products in store-assigned deleted orders so their
-- aggregate stock cache can be recalculated after reservations have been released.
INSERT OR IGNORE INTO fw_purge_20261103_store_stock_products
SELECT DISTINCT oi.product_id
FROM order_items oi
JOIN orders o ON o.id=oi.order_id
JOIN fw_purge_20261103_orders doomed ON doomed.order_id=o.id
JOIN products p ON p.id=oi.product_id AND p.stock_managed=1
WHERE o.assigned_store_id IS NOT NULL
UNION
SELECT DISTINCT r.product_id
FROM delivery_store_inventory_reservations r
JOIN fw_purge_20261103_orders doomed ON doomed.order_id=r.order_id
JOIN products p ON p.id=r.product_id AND p.stock_managed=1;

-- Restore aggregate stock only for unfulfilled legacy orders without a store assignment.
-- Delivered items remain consumed; active store reservations are released, not restocked.
UPDATE products
SET stock_quantity=stock_quantity+COALESCE((
 SELECT SUM(oi.stock_reserved_qty) FROM order_items oi
 JOIN orders o ON o.id=oi.order_id
 JOIN fw_purge_20261103_orders d ON d.order_id=o.id
 WHERE oi.product_id=products.id AND oi.stock_reserved_qty>0
 AND o.assigned_store_id IS NULL
 AND LOWER(COALESCE(o.delivery_status,'')) NOT IN ('delivered','cancelled')
),0),updated_at=CURRENT_TIMESTAMP
WHERE stock_managed=1 AND EXISTS(
 SELECT 1 FROM order_items oi JOIN fw_purge_20261103_orders d ON d.order_id=oi.order_id
 WHERE oi.product_id=products.id AND oi.stock_reserved_qty>0
);

-- Remove the complete order history and every order-scoped dependency.
DELETE FROM invoice_items WHERE invoice_id IN (
 SELECT i.id FROM invoices i JOIN fw_purge_20261103_orders d ON d.order_id=i.order_id
);
DELETE FROM invoices WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM coupon_redemptions WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM first_order_coupon_claims WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM delivery_store_inventory_reservations WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM delivery_slot_reservations WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM order_action_requests WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM order_audit_events WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM order_operational_flags WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);
DELETE FROM notification_events WHERE order_id IN (SELECT order_id FROM fw_purge_20261103_orders);

-- Cascades remove order line items and delivery address snapshots.
DELETE FROM orders WHERE id IN (SELECT order_id FROM fw_purge_20261103_orders);

-- Recalculate aggregate stock for still-existing stock-managed products whose active
-- store reservations were removed. This does not alter any store's physical inventory.
UPDATE products
SET stock_quantity=MAX(0,
  (SELECT COALESCE(SUM(i.stock_quantity),0)
   FROM delivery_store_inventory i
   JOIN delivery_stores s ON s.id=i.store_id AND s.is_active=1
   WHERE i.product_id=products.id)
  -
  (SELECT COALESCE(SUM(r.qty),0)
   FROM delivery_store_inventory_reservations r
   JOIN delivery_stores s ON s.id=r.store_id AND s.is_active=1
   WHERE r.product_id=products.id AND r.status IN ('reserved','conflict'))
),updated_at=CURRENT_TIMESTAMP
WHERE stock_managed=1
AND id IN (SELECT product_id FROM fw_purge_20261103_store_stock_products);

-- Remove restrictive per-store inventory rows; catalogue rows cascade with products.
DELETE FROM delivery_store_inventory WHERE product_id IN (SELECT product_id FROM fw_purge_20261103_products);
DELETE FROM products WHERE id IN (SELECT product_id FROM fw_purge_20261103_products);

DROP TABLE fw_purge_20261103_store_stock_products;
DROP TABLE fw_purge_20261103_orders;
DROP TABLE fw_purge_20261103_products;
