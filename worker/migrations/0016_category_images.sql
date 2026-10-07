-- Store compressed catalogue category images in D1 for now; no R2/object storage required.
ALTER TABLE categories ADD COLUMN image_data TEXT;
ALTER TABLE categories ADD COLUMN image_mime_type TEXT;
