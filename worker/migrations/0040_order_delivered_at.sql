-- Preserve the actual delivery completion timestamp independently of later order edits.
ALTER TABLE orders ADD COLUMN delivered_at TEXT;
