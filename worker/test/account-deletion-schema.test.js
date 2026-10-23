import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0033_account_deletion_requests.sql', import.meta.url), 'utf8');

test('fresh schema and additive migration define the same account-deletion request table', () => {
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS account_deletion_requests/);
    assert.match(source, /customer_id TEXT NOT NULL/);
    assert.match(source, /status TEXT NOT NULL DEFAULT 'pending'/);
    assert.match(source, /source TEXT NOT NULL/);
    assert.match(source, /admin_note TEXT NOT NULL DEFAULT ''/);
    assert.match(source, /idx_account_deletion_requests_one_active/);
    assert.match(source, /WHERE status IN \('pending','in_review'\)/);
  }
});

test('deletion requests deliberately do not cascade-delete customers or orders', () => {
  const table = migration.split('CREATE TABLE IF NOT EXISTS account_deletion_requests')[1]?.split(';')[0] || '';
  assert.doesNotMatch(table, /FOREIGN KEY\s*\(/i);
  assert.match(schema, /FOREIGN KEY\(customer_id\) REFERENCES customers\(id\) ON DELETE RESTRICT/);
  assert.match(schema, /FOREIGN KEY\(customer_id\) REFERENCES customers\(id\) ON DELETE RESTRICT/);
});
