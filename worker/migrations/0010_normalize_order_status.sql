-- Normalize the legacy Ordered value to the canonical New lifecycle state.
-- Keep compatibility with any older code or existing D1 rows that still use Ordered.

UPDATE orders
SET delivery_status = 'New', updated_at = CURRENT_TIMESTAMP
WHERE delivery_status = 'Ordered';

CREATE TRIGGER IF NOT EXISTS orders_normalize_ordered_insert
AFTER INSERT ON orders
WHEN NEW.delivery_status = 'Ordered'
BEGIN
  UPDATE orders
  SET delivery_status = 'New', updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS orders_normalize_ordered_update
AFTER UPDATE OF delivery_status ON orders
WHEN NEW.delivery_status = 'Ordered'
BEGIN
  UPDATE orders
  SET delivery_status = 'New', updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
