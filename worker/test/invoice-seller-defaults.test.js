import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0030_invoice_seller_details_defaults.sql', import.meta.url), 'utf8');

test('invoice seller defaults are seeded from the provided receipt', () => {
  for (const value of [
    'Sunshine Enterprises (Freshway)',
    '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208',
    '+917396805280',
    'Telangana',
    '36AEXFS4597F1Z6',
    'Thank You For Shopping With Freshway'
  ]) {
    assert.ok(migration.includes(value), 'missing seller default: ' + value);
  }
  assert.match(migration, /state_code\s*=\s*CASE WHEN TRIM\(COALESCE\(state_code, ''\)\) = '' THEN '36'/);
});

test('seller defaults preserve every non-empty field and never enable invoicing', () => {
  assert.match(migration, /phone\s*=\s*CASE WHEN TRIM\(COALESCE\(phone, ''\)\) = '' THEN '[^']+' ELSE phone END/);
  assert.match(migration, /address\s*=\s*CASE WHEN TRIM\(COALESCE\(address, ''\)\) = '' THEN '[^']+' ELSE address END/);
  assert.match(migration, /legal_name\s*=\s*CASE WHEN TRIM\(COALESCE\(legal_name, ''\)\) = '' THEN '[^']+' ELSE legal_name END/);
  assert.match(migration, /WHERE id = 1\s+AND enabled = 0/);
  assert.doesNotMatch(migration, /SET\s+enabled\s*=/i, 'invoice issuance must remain disabled');
});

test('unconfigured records with the receipt GSTIN default to GST tax-invoice mode but stay disabled', () => {
  assert.match(migration, /document_type = CASE\s+WHEN document_type = 'commercial_invoice'\s+AND TRIM\(COALESCE\(gstin, ''\)\) = ''\s+THEN 'gst_tax_invoice'/);
  assert.match(migration, /WHERE id = 1\s+AND enabled = 0/);
});
