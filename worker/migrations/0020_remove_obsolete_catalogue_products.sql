-- Remove the original demo catalogue products that are no longer part of FreshWay.
-- Only products with no historical order_items are eligible for permanent deletion.
DELETE FROM products
WHERE lower(trim(name)) IN ('apple','banana','grapes','guava')
  AND NOT EXISTS (
    SELECT 1
    FROM order_items oi
    WHERE oi.product_id = products.id
  );