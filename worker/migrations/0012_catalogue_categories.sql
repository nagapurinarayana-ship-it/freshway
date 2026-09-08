-- FreshWay V1 catalogue: data-driven categories with products belonging to one category.
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '🛒',
  description TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 999,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE products ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN display_order INTEGER NOT NULL DEFAULT 999;
CREATE INDEX IF NOT EXISTS idx_categories_active_order ON categories(active, display_order, name);
CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category_id, active, name);

INSERT OR IGNORE INTO categories (id,name,slug,icon,description,display_order,active)
VALUES ('cat-oils','Oils','oils','🫒','Cooking and everyday oils',1,1),
       ('cat-rice','Rice','rice','🍚','Rice and rice varieties',2,1);

-- Remove the old fruit catalogue from customer view without deleting historical product IDs.
UPDATE products SET active=0 WHERE id IN ('apple','banana','mango','orange','watermelon','grapes','pineapple','guava','papaya','pomegranate');
