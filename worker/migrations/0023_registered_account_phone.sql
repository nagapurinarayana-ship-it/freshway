-- Historical orders must use the customer's registered account phone in the
-- denormalized customer_phone field. The immutable order-address snapshot keeps
-- the contact number used for that specific delivery.
UPDATE orders
SET customer_phone = (
  SELECT c.phone
  FROM customers c
  WHERE c.id = orders.customer_id
    AND c.phone IS NOT NULL
    AND TRIM(c.phone) <> ''
)
WHERE EXISTS (
  SELECT 1
  FROM customers c
  WHERE c.id = orders.customer_id
    AND c.phone IS NOT NULL
    AND TRIM(c.phone) <> ''
);
