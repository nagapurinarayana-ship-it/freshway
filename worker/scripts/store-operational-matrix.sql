WITH reserved AS (
  SELECT store_id,product_id,SUM(qty) qty
  FROM delivery_store_inventory_reservations
  WHERE status IN ('reserved','conflict')
  GROUP BY store_id,product_id
)
SELECT
  s.id store_id,
  s.name store_name,
  s.address store_address,
  s.latitude,
  s.longitude,
  s.service_radius_km,
  s.is_active store_active,
  p.id product_id,
  p.name product_name,
  p.unit,
  p.price central_price,
  p.active product_active,
  p.category_id,
  c.name category_name,
  COALESCE(c.active,0) category_active,
  p.stock_managed,
  p.low_stock_threshold,
  sc.store_id catalogue_store_id,
  sc.is_available store_product_available,
  sc.price_override,
  COALESCE(sc.price_override,p.price) effective_price,
  i.store_id inventory_store_id,
  COALESCE(i.stock_quantity,0) on_hand,
  COALESCE(r.qty,0) reserved_qty,
  MAX(0,COALESCE(i.stock_quantity,0)-COALESCE(r.qty,0)) available_qty
FROM delivery_stores s
CROSS JOIN products p
LEFT JOIN categories c ON c.id=p.category_id
LEFT JOIN delivery_store_catalogue sc ON sc.store_id=s.id AND sc.product_id=p.id
LEFT JOIN delivery_store_inventory i ON i.store_id=s.id AND i.product_id=p.id
LEFT JOIN reserved r ON r.store_id=s.id AND r.product_id=p.id
ORDER BY s.name,s.id,p.name,p.id;
