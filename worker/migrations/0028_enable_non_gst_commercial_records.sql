-- Enable only a non-GST commercial order record when the saved Store Profile
-- already contains the minimum seller identity. Never auto-enable a GST document
-- or infer GST registration/product tax rates.
UPDATE invoice_settings
SET enabled = 1,
    document_type = 'commercial_invoice',
    legal_name = CASE
      WHEN length(trim(COALESCE(legal_name, ''))) > 0 THEN legal_name
      ELSE (SELECT store_name FROM store_profile WHERE id = 1)
    END,
    business_address = CASE
      WHEN length(trim(COALESCE(business_address, ''))) > 0 THEN business_address
      ELSE (SELECT address FROM store_profile WHERE id = 1)
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND enabled = 0
  AND length(trim(COALESCE(gstin, ''))) = 0
  AND EXISTS (
    SELECT 1
    FROM store_profile
    WHERE id = 1
      AND length(trim(COALESCE(store_name, ''))) > 0
      AND length(trim(COALESCE(address, ''))) > 0
  );
