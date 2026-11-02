-- Store-first delivery fulfilment safeguards.
-- New customer orders and active stock reservations may only target an active store.
-- Deactivating a store does not touch historical orders or existing reservations.
CREATE TRIGGER IF NOT EXISTS delivery_order_store_active_before_insert
BEFORE INSERT ON orders
WHEN NEW.assigned_store_id IS NOT NULL
BEGIN
  SELECT CASE WHEN COALESCE(
    (SELECT is_active FROM delivery_stores WHERE id=NEW.assigned_store_id),0
  )<>1 THEN RAISE(ABORT,'DELIVERY_STORE_INACTIVE') END;
END;

CREATE TRIGGER IF NOT EXISTS delivery_order_store_active_before_update
BEFORE UPDATE OF assigned_store_id ON orders
WHEN NEW.assigned_store_id IS NOT NULL AND NEW.assigned_store_id IS NOT OLD.assigned_store_id
BEGIN
  SELECT CASE WHEN COALESCE(
    (SELECT is_active FROM delivery_stores WHERE id=NEW.assigned_store_id),0
  )<>1 THEN RAISE(ABORT,'DELIVERY_STORE_INACTIVE') END;
END;

CREATE TRIGGER IF NOT EXISTS delivery_order_store_open_before_update
BEFORE UPDATE OF assigned_store_id ON orders
WHEN NEW.assigned_store_id IS NOT OLD.assigned_store_id
  AND LOWER(COALESCE(OLD.delivery_status,'')) IN ('delivered','cancelled')
BEGIN
  SELECT RAISE(ABORT,'DELIVERY_ORDER_CLOSED');
END;

CREATE TRIGGER IF NOT EXISTS delivery_store_reservation_order_open_before_insert
BEFORE INSERT ON delivery_store_inventory_reservations
WHEN NEW.status='reserved'
  AND EXISTS(SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND LOWER(COALESCE(o.delivery_status,'')) IN ('delivered','cancelled'))
BEGIN
  SELECT RAISE(ABORT,'DELIVERY_ORDER_CLOSED');
END;

CREATE TRIGGER IF NOT EXISTS delivery_store_active_before_insert
BEFORE INSERT ON delivery_store_inventory_reservations
WHEN NEW.status='reserved'
BEGIN
  SELECT CASE WHEN COALESCE(
    (SELECT is_active FROM delivery_stores WHERE id=NEW.store_id),0
  )<>1 THEN RAISE(ABORT,'DELIVERY_STORE_INACTIVE') END;
END;

CREATE TRIGGER IF NOT EXISTS delivery_store_active_before_update
BEFORE UPDATE OF store_id,status ON delivery_store_inventory_reservations
WHEN NEW.status='reserved'
BEGIN
  SELECT CASE WHEN COALESCE(
    (SELECT is_active FROM delivery_stores WHERE id=NEW.store_id),0
  )<>1 THEN RAISE(ABORT,'DELIVERY_STORE_INACTIVE') END;
END;
