-- Restore the supported initial customer catalogue after test-data cleanup.
-- Idempotent: existing products are left unchanged. Retired fruit products are intentionally omitted.
INSERT OR IGNORE INTO products (id,name,unit,price,emoji,active) VALUES
  ('apple','Apple','kg',120,'🍎',1),
  ('banana','Banana','dozen',60,'🍌',1),
  ('grapes','Grapes','kg',110,'🍇',1),
  ('guava','Guava','kg',90,'🍐',1);
