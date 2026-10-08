CREATE TABLE IF NOT EXISTS home_promotions (
  id TEXT PRIMARY KEY,
  image_data TEXT,
  image_mime_type TEXT,
  alt_text TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 999,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_home_promotions_active_order
  ON home_promotions(active, display_order, id);
