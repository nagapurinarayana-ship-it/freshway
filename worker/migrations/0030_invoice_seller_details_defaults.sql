-- Seed the seller details from the existing Sunshine Enterprises (Freshway) receipt.
-- This is a one-time default only: retain every non-empty value already configured by the owner.
-- Invoice issuance deliberately remains OFF until the owner confirms GST and product tax details.

UPDATE store_profile
SET phone = CASE WHEN TRIM(COALESCE(phone, '')) = '' THEN '+917396805280' ELSE phone END,
    address = CASE WHEN TRIM(COALESCE(address, '')) = '' THEN '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208' ELSE address END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND (
    TRIM(COALESCE(phone, '')) = ''
    OR TRIM(COALESCE(address, '')) = ''
  );

UPDATE invoice_settings
SET legal_name = CASE WHEN TRIM(COALESCE(legal_name, '')) = '' THEN 'Sunshine Enterprises (Freshway)' ELSE legal_name END,
    business_address = CASE WHEN TRIM(COALESCE(business_address, '')) = '' THEN '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208' ELSE business_address END,
    state_name = CASE WHEN TRIM(COALESCE(state_name, '')) = '' THEN 'Telangana' ELSE state_name END,
    state_code = CASE WHEN TRIM(COALESCE(state_code, '')) = '' THEN '36' ELSE state_code END,
    gstin = CASE WHEN TRIM(COALESCE(gstin, '')) = '' THEN '36AEXFS4597F1Z6' ELSE gstin END,
    footer = CASE WHEN TRIM(COALESCE(footer, '')) = '' THEN 'Thank You For Shopping With Freshway' ELSE footer END,
    document_type = CASE
      WHEN enabled = 0
        AND document_type = 'commercial_invoice'
        AND TRIM(COALESCE(legal_name, '')) = ''
        AND TRIM(COALESCE(business_address, '')) = ''
        AND TRIM(COALESCE(state_name, '')) = ''
        AND TRIM(COALESCE(state_code, '')) = ''
        AND TRIM(COALESCE(gstin, '')) = ''
        AND TRIM(COALESCE(footer, '')) = ''
      THEN 'gst_tax_invoice'
      ELSE document_type
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND (
    TRIM(COALESCE(legal_name, '')) = ''
    OR TRIM(COALESCE(business_address, '')) = ''
    OR TRIM(COALESCE(state_name, '')) = ''
    OR TRIM(COALESCE(state_code, '')) = ''
    OR TRIM(COALESCE(gstin, '')) = ''
    OR TRIM(COALESCE(footer, '')) = ''
    OR (
      enabled = 0
      AND document_type = 'commercial_invoice'
      AND TRIM(COALESCE(legal_name, '')) = ''
      AND TRIM(COALESCE(business_address, '')) = ''
      AND TRIM(COALESCE(state_name, '')) = ''
      AND TRIM(COALESCE(state_code, '')) = ''
      AND TRIM(COALESCE(gstin, '')) = ''
      AND TRIM(COALESCE(footer, '')) = ''
    )
  );
