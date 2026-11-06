WITH affected_orders AS (
  SELECT o.id
  FROM orders o
  LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id
  WHERE o.is_test_order=0
    AND o.delivery_status NOT IN ('Delivered','Cancelled')
    AND (o.assigned_store_id IS NULL OR ds.id IS NULL OR ds.is_active<>1)
)
SELECT
  e.order_id,
  e.created_at event_created_at,
  e.actor_type,
  e.action,
  json_extract(e.before_json,'$.delivery_status') before_delivery_status,
  json_extract(e.after_json,'$.delivery_status') after_delivery_status,
  json_extract(e.before_json,'$.assigned_store_id') before_assigned_store_id,
  json_extract(e.after_json,'$.assigned_store_id') after_assigned_store_id,
  json_extract(e.after_json,'$.storeId') after_store_id,
  json_extract(e.after_json,'$.storeName') after_store_name,
  json_extract(e.after_json,'$.date') after_date,
  json_extract(e.after_json,'$.status') after_schedule_status,
  (
    SELECT GROUP_CONCAT(r.request_type || ':' || r.status || ':' || COALESCE(r.requested_delivery_date,''),' | ')
    FROM order_action_requests r
    WHERE r.order_id=e.order_id
  ) request_states,
  (
    SELECT GROUP_CONCAT(f.flag_type || ':' || f.status,' | ')
    FROM order_operational_flags f
    WHERE f.order_id=e.order_id
  ) operational_flags
FROM order_audit_events e
JOIN affected_orders a ON a.id=e.order_id
ORDER BY e.order_id,e.created_at,e.id;
