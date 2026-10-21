-- Keep the human-readable business address unchanged while storing an exact shop map pin.
-- Nullable values preserve the existing address-based map link until an owner confirms a pin.
ALTER TABLE store_profile ADD COLUMN shop_latitude REAL;
ALTER TABLE store_profile ADD COLUMN shop_longitude REAL;
