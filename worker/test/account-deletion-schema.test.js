import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0033_account_deletion_requests.sql', import.meta.url), 'utf8');
const erasureMigration = readFileSync(new URL('../migrations/0034_customer_account_erasure.sql', import.meta.url), 'utf8');
const snapshotRedactionMigration = readFileSync(new URL('../migrations/0035_nullable_snapshot_customer_id_for_erasure.sql', import.meta.url), 'utf8');
const anonymizationMigration = readFileSync(new URL('../migrations/0036_anonymize_completed_deletion_requests.sql', import.meta.url), 'utf8');
const accountDeletion = readFileSync(new URL('../src/account-deletion.js', import.meta.url), 'utf8');
const productionAudit = readFileSync(new URL('../scripts/audit-production-schema.mjs', import.meta.url), 'utf8');

test('baseline migration and current schema define a deletion-request table that supports anonymized completion', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_deletion_requests/);
  assert.match(migration, /customer_id TEXT NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS account_deletion_requests/);
  assert.match(schema, /customer_id TEXT, phone_snapshot TEXT NOT NULL/);
  for (const source of [schema, migration]) {
    assert.match(source, /status TEXT NOT NULL DEFAULT 'pending'/);
    assert.match(source, /source TEXT NOT NULL/);
    assert.match(source, /admin_note TEXT NOT NULL DEFAULT ''/);
    assert.match(source, /idx_account_deletion_requests_one_active/);
    assert.match(source, /WHERE status IN \('pending','in_review'\)/);
  }
});

test('migration detaches completed requests from customers and replaces free-text notes with a safe outcome', () => {
  assert.match(anonymizationMigration, /CREATE TABLE account_deletion_requests_erasure_safe \([\s\S]*?customer_id TEXT,/);
  assert.match(anonymizationMigration, /CASE WHEN status='completed' THEN NULL ELSE customer_id END/);
  assert.match(anonymizationMigration, /CASE WHEN status='completed' THEN 'REDACTED' ELSE phone_snapshot END/);
  assert.match(anonymizationMigration, /Completed: operational customer data redacted; applicable invoice\/transaction records retained under approved tax\/accounting retention/);
  assert.match(anonymizationMigration, /DROP TABLE account_deletion_requests;/);
  assert.match(accountDeletion, /SET status='completed',customer_id=NULL,phone_snapshot='REDACTED'/);
  assert.match(productionAudit, /0036_anonymize_completed_deletion_requests\.sql/);
});

test('deletion requests deliberately do not cascade-delete customers or orders', () => {
  const table = migration.split('CREATE TABLE IF NOT EXISTS account_deletion_requests')[1]?.split(';')[0] || '';
  assert.doesNotMatch(table, /FOREIGN KEY\s*\(/i);
  assert.match(schema, /FOREIGN KEY\(customer_id\) REFERENCES customers\(id\) ON DELETE RESTRICT/);
  assert.match(schema, /FOREIGN KEY\(customer_id\) REFERENCES customers\(id\) ON DELETE CASCADE/);
});


test('customer tombstone schema supports account erasure without deleting historical references', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS customers \([\s\S]*?deleted_at TEXT/);
  assert.match(erasureMigration, /ALTER TABLE customers ADD COLUMN deleted_at TEXT/);
  assert.match(erasureMigration, /idx_customers_active_phone/);
  assert.match(erasureMigration, /WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''/);
});


test('snapshot redaction migration makes customer_id nullable without dropping order/address integrity', () => {
  const create = snapshotRedactionMigration.split('CREATE TABLE order_address_snapshots_erasure_safe')[1]?.split(');')[0] || '';
  assert.match(create, /customer_id TEXT,/);
  assert.doesNotMatch(create, /customer_id TEXT NOT NULL/);
  assert.match(create, /FOREIGN KEY\(order_id\) REFERENCES orders\(id\) ON DELETE CASCADE/);
  assert.match(create, /FOREIGN KEY\(address_id\) REFERENCES addresses\(id\) ON DELETE SET NULL/);
  assert.match(snapshotRedactionMigration, /INSERT INTO order_address_snapshots_erasure_safe/);
  assert.match(snapshotRedactionMigration, /DROP TABLE order_address_snapshots;/);
  assert.match(snapshotRedactionMigration, /idx_order_address_snapshots_customer/);
  assert.match(snapshotRedactionMigration, /idx_order_address_snapshots_coordinates/);
  assert.match(accountDeletion, /UPDATE order_address_snapshots SET customer_id=NULL/);
  assert.match(productionAudit, /order_address_snapshots\.customer_id must allow NULL for account erasure/);
});

test('production deletion errors only call foreign-key failures linked-record conflicts', () => {
  const adminAuth = readFileSync(new URL('../src/admin-auth.js', import.meta.url), 'utf8');
  assert.match(adminAuth, /foreignKeyConflict=\/foreign key constraint failed\/i\.test\(message\)/);
  assert.match(adminAuth, /integrityConflict=\/not null constraint failed\|check constraint failed\|unique constraint failed\/i\.test\(message\)/);
});
