CREATE TABLE IF NOT EXISTS store_profile (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  store_name TEXT NOT NULL DEFAULT 'FreshWay',
  about TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '',
  delivery_info TEXT NOT NULL DEFAULT '',
  share_title TEXT NOT NULL DEFAULT 'FreshWay | Fresh Groceries & Everyday Essentials Delivered Locally',
  share_description TEXT NOT NULL DEFAULT 'Shop fresh fruits, groceries and everyday essentials from FreshWay. Order online for local delivery with convenient cash payment.',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO store_profile (id) VALUES (1);
