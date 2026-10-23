-- Fill only blank invoice seller fields from the receipt details supplied by the owner.
-- Values remain editable in Owner -> Settings -> Billing & tax. No external GSTIN lookup is performed.
-- Do not modify issuance state, document type, tax calculations, orders, or existing invoice snapshots.
UPDATE invoice_settings
SET legal_name = CASE WHEN TRIM(COALESCE(legal_name, '')) = '' THEN 'Sunshine Enterprises (Freshway)' ELSE legal_name END,
    business_address = CASE WHEN TRIM(COALESCE(business_address, '')) = '' THEN '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208' ELSE business_address END,
    state_name = CASE WHEN TRIM(COALESCE(state_name, '')) = '' THEN 'Telangana' ELSE state_name END,
    state_code = CASE WHEN TRIM(COALESCE(state_code, '')) = '' THEN '36' ELSE state_code END,
    gstin = CASE WHEN TRIM(COALESCE(gstin, '')) = '' THEN '36AEXFS4597F1Z6' ELSE gstin END,
    footer = CASE WHEN TRIM(COALESCE(footer, '')) = '' THEN 'Thank You For Shopping With Freshway' ELSE footer END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND (
    TRIM(COALESCE(legal_name, '')) = ''
    OR TRIM(COALESCE(business_address, '')) = ''
    OR TRIM(COALESCE(state_name, '')) = ''
    OR TRIM(COALESCE(state_code, '')) = ''
    OR TRIM(COALESCE(gstin, '')) = ''
    OR TRIM(COALESCE(footer, '')) = ''
  );
