SELECT
  o.id order_id,
  o.created_at,
  o.delivery_status,
  o.payment_status,
  o.delivery_plan,
  o.scheduled_delivery_date,
  o.assigned_store_id,
  ds.name assigned_store_name,
  COALESCE(ds.is_active,0) assigned_store_active,
  COALESCE(s.latitude,a.latitude) location_latitude,
  COALESCE(s.longitude,a.longitude) location_longitude,
  CASE
    WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL THEN 'order_snapshot'
    WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL THEN 'address_record'
    ELSE 'missing'
  END location_source,
  COALESCE(item_rollup.items_json,'[]') items_json
FROM orders o
LEFT JOIN addresses a ON a.id=o.address_id
LEFT JOIN order_address_snapshots s ON s.order_id=o.id
LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id
LEFT JOIN (
  SELECT
    order_id,
    json_group_array(json_object(
      'productId',product_id,
      'name',name,
      'qty',qty,
      'stockReservedQty',stock_reserved_qty
    )) items_json
  FROM order_items
  GROUP BY order_id
) item_rollup ON item_rollup.order_id=o.id
WHERE o.is_test_order=0
  AND o.delivery_status NOT IN ('Delivered','Cancelled')
  AND (o.assigned_store_id IS NULL OR ds.id IS NULL OR ds.is_active<>1)
ORDER BY o.created_at DESC,o.id;
