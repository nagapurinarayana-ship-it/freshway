-- Store inventory cannot be reduced beneath stock already promised to active orders.
-- The API also pre-validates this rule; the trigger closes the race with concurrent checkouts.
CREATE TRIGGER IF NOT EXISTS delivery_store_inventory_stock_floor_before_update
BEFORE UPDATE OF stock_quantity ON delivery_store_inventory
BEGIN
  SELECT CASE WHEN NEW.stock_quantity < COALESCE((
    SELECT SUM(qty)
    FROM delivery_store_inventory_reservations
    WHERE store_id=NEW.store_id
      AND product_id=NEW.product_id
      AND status IN ('reserved','conflict')
  ),0)
  THEN RAISE(ABORT,'DELIVERY_STORE_STOCK_RESERVED') END;
END;
