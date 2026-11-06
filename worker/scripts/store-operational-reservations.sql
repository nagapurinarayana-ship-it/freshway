WITH expected AS (
  SELECT
    o.id order_id,
    o.assigned_store_id,
    o.delivery_status,
    oi.product_id,
    MIN(oi.name) product_name,
    SUM(oi.stock_reserved_qty) expected_reserved_qty
  FROM orders o
  JOIN order_items oi ON oi.order_id=o.id
  WHERE o.is_test_order=0
    AND o.delivery_status NOT IN ('Delivered','Cancelled')
    AND oi.stock_reserved_qty>0
  GROUP BY o.id,o.assigned_store_id,o.delivery_status,oi.product_id
),
actual AS (
  SELECT
    order_id,
    product_id,
    SUM(qty) actual_reserved_qty,
    COUNT(DISTINCT store_id) actual_store_count,
    GROUP_CONCAT(DISTINCT store_id) actual_store_ids
  FROM delivery_store_inventory_reservations
  WHERE status IN ('reserved','conflict')
  GROUP BY order_id,product_id
),
keys AS (
  SELECT order_id,product_id FROM expected
  UNION
  SELECT order_id,product_id FROM actual
)
SELECT
  o.id order_id,
  o.delivery_status,
  o.assigned_store_id,
  k.product_id,
  COALESCE(e.product_name,(SELECT MIN(oi.name) FROM order_items oi WHERE oi.order_id=o.id AND oi.product_id=k.product_id)) product_name,
  COALESCE(e.expected_reserved_qty,0) expected_reserved_qty,
  COALESCE(a.actual_reserved_qty,0) actual_reserved_qty,
  COALESCE(a.actual_store_count,0) actual_store_count,
  COALESCE(a.actual_store_ids,'') actual_store_ids
FROM keys k
JOIN orders o ON o.id=k.order_id
LEFT JOIN expected e ON e.order_id=k.order_id AND e.product_id=k.product_id
LEFT JOIN actual a ON a.order_id=k.order_id AND a.product_id=k.product_id
WHERE o.is_test_order=0
  AND o.delivery_status NOT IN ('Delivered','Cancelled')
  AND (
    COALESCE(e.expected_reserved_qty,0)<>COALESCE(a.actual_reserved_qty,0)
    OR (COALESCE(a.actual_reserved_qty,0)>0 AND (
      COALESCE(a.actual_store_count,0)<>1
      OR COALESCE(a.actual_store_ids,'')<>COALESCE(o.assigned_store_id,'')
    ))
    OR (COALESCE(e.expected_reserved_qty,0)>0 AND o.assigned_store_id IS NULL)
  )
ORDER BY o.created_at DESC,o.id,k.product_id;
