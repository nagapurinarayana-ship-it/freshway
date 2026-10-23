import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0032_correct_legacy_receipt_seller_defaults.sql', import.meta.url), 'utf8');

test('corrects only known legacy receipt identity placeholders', () => {
  assert.ok(migration.includes("'Sunshine Enterprises (Freshway)'"));
  assert.ok(migration.includes("'1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208'"));
  assert.match(migration, /LOWER\(TRIM\(COALESCE\(legal_name, ''\)\)\) = 'freshway'/);
  assert.match(migration, /LOWER\(TRIM\(COALESCE\(business_address, ''\)\)\) IN \('mancherial', 'mancherial telangana'\)/);
  assert.match(migration, /UPDATE store_profile[\s\S]*WHERE id = 1[\s\S]*LOWER\(TRIM\(COALESCE\(address, ''\)\)\) IN/);
});

test('keeps non-placeholder seller values and all issued transactional records untouched', () => {
  assert.match(migration, /ELSE legal_name\s+END/);
  assert.match(migration, /ELSE business_address\s+END/);
  assert.doesNotMatch(migration, /UPDATE\s+(invoices|invoice_items|orders|customers)\b/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});
