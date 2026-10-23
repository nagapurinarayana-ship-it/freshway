-- Replace only the known generic seller placeholders left by older defaults.
-- Any non-placeholder owner-entered business name/address is preserved. No invoice,
-- order, customer, or invoice-item rows are rewritten.
UPDATE invoice_settings
SET legal_name = CASE
      WHEN LOWER(TRIM(COALESCE(legal_name, ''))) = 'freshway'
      THEN 'Sunshine Enterprises (Freshway)'
      ELSE legal_name
    END,
    business_address = CASE
      WHEN LOWER(TRIM(COALESCE(business_address, ''))) IN ('mancherial', 'mancherial telangana')
      THEN '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208'
      ELSE business_address
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND (
    LOWER(TRIM(COALESCE(legal_name, ''))) = 'freshway'
    OR LOWER(TRIM(COALESCE(business_address, ''))) IN ('mancherial', 'mancherial telangana')
  );

-- The store profile is also shown to customers. Expand only a city-only address,
-- leaving any full address already entered by the owner untouched.
UPDATE store_profile
SET address = '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND LOWER(TRIM(COALESCE(address, ''))) IN ('mancherial', 'mancherial telangana');
