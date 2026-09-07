-- Replace SMS OTP authentication with a customer-created 6-digit passcode.
-- Existing customer/order data is preserved; passcodes are added only when customers register.
ALTER TABLE customers ADD COLUMN passcode_salt TEXT;
ALTER TABLE customers ADD COLUMN passcode_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_phone_passcode ON customers(phone);
