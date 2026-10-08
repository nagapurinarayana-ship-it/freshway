-- Hard-reset legacy demo catalogue data only.
-- The current FreshWay catalogue (Oils/Rice and its current products) is untouched.
-- Orders containing the obsolete demo products are intentionally removed at the
-- user's request. Their dependent order_items and order_address_snapshots cascade.
--
-- D1 migrations are executed atomically by the migration system, so do not wrap
-- this migration in explicit BEGIN/COMMIT statements.

DELETE FROM orders
WHERE id IN (
  SELECT DISTINCT oi.order_id
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE lower(trim(p.name)) IN ('apple','banana','grapes','guava')
);

DELETE FROM products
WHERE lower(trim(name)) IN ('apple','banana','grapes','guava');
