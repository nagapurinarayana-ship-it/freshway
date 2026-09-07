-- A verified mobile number is the customer identity boundary.
-- Keep legacy blank/unverified rows out of the unique constraint so existing
-- placeholder records do not block migration; verified phone numbers must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_unique
  ON customers(phone)
  WHERE phone IS NOT NULL AND phone <> '';
