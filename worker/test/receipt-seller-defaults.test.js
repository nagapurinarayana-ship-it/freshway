import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0031_receipt_seller_defaults.sql', import.meta.url), 'utf8');

test('receipt seller defaults fill only blank settings and preserve existing owner values', () => {
  for (const value of [
    'Sunshine Enterprises (Freshway)',
    '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208',
    'Telangana',
    "'36'",
    '36AEXFS4597F1Z6',
    'Thank You For Shopping With Freshway'
  ]) assert.ok(migration.includes(value), 'missing receipt default: ' + value);
  assert.match(migration, /gstin = CASE WHEN TRIM\(COALESCE\(gstin, ''\)\) = '' THEN '36AEXFS4597F1Z6' ELSE gstin END/);
  assert.match(migration, /legal_name = CASE WHEN TRIM\(COALESCE\(legal_name, ''\)\) = '' THEN '[^']+' ELSE legal_name END/);
});

test('receipt defaults do not enable invoicing, change document type, or rewrite invoice records', () => {
  assert.doesNotMatch(migration, /SET\s+enabled\s*=/i);
  assert.doesNotMatch(migration, /SET\s+document_type\s*=/i);
  assert.doesNotMatch(migration, /UPDATE\s+invoices\b/i);
  assert.doesNotMatch(migration, /fetch\s*\(|https?:\/\//i, 'the migration must not perform external verification');
});
