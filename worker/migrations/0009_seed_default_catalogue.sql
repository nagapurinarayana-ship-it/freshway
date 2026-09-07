-- Restore the initial customer catalogue after test-data cleanup.
-- Idempotent: existing products are left unchanged.
INSERT OR IGNORE INTO products (id,name,unit,price,emoji,active) VALUES
  ('apple','Apple','kg',120,'🍎',1),
  ('banana','Banana','dozen',60,'🍌',1),
  ('mango','Mango','kg',180,'🥭',1),
  ('orange','Orange','kg',100,'🍊',1),
  ('watermelon','Watermelon','piece',50,'🍉',1),
  ('grapes','Grapes','kg',110,'🍇',1),
  ('pineapple','Pineapple','piece',70,'🍍',1),
  ('guava','Guava','kg',90,'🍐',1),
  ('papaya','Papaya','piece',80,'🧡',1),
  ('pomegranate','Pomegranate','kg',160,'❤️',1);
