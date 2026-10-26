-- Let customer-linked delivery requests be anonymized while retaining the order's operational history.
-- Rebuild instead of ALTER COLUMN so existing D1 databases can apply this safely.
CREATE TABLE order_action_requests_rebuilt (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK(request_type IN ('cancellation','reschedule','return','issue')),
  requested_slot_id TEXT REFERENCES delivery_slots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO order_action_requests_rebuilt
  (id,order_id,customer_id,request_type,requested_slot_id,reason,status,resolution_note,resolved_by,created_at,updated_at)
SELECT id,order_id,customer_id,request_type,requested_slot_id,reason,status,resolution_note,resolved_by,created_at,updated_at
FROM order_action_requests;
DROP TABLE order_action_requests;
ALTER TABLE order_action_requests_rebuilt RENAME TO order_action_requests;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_action_one_pending_type
  ON order_action_requests(order_id,request_type) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_order_action_queue
  ON order_action_requests(status,created_at DESC);
