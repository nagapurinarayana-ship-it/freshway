-- Store compressed product images in D1 for now; no R2/object storage required.
ALTER TABLE products ADD COLUMN image_data TEXT;
ALTER TABLE products ADD COLUMN image_mime_type TEXT;
