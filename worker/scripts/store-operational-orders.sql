SELECT
  o.id order_id,
  o.delivery_status,
  o.assigned_store_id,
  ds.name assigned_store_name,
  COALESCE(ds.is_active,0) assigned_store_active
FROM orders o
LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id
WHERE o.is_test_order=0
  AND o.delivery_status NOT IN ('Delivered','Cancelled')
  AND (o.assigned_store_id IS NULL OR ds.id IS NULL OR ds.is_active<>1)
ORDER BY o.created_at DESC,o.id;
