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

test('baseline migration and current schema define deletion requests and aggregate-only completion metrics', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_deletion_requests/);
  assert.match(migration, /customer_id TEXT NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS account_deletion_requests/);
  assert.match(schema, /customer_id TEXT NOT NULL, phone_snapshot TEXT NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS account_deletion_summary/);
  assert.match(schema, /completed_count INTEGER NOT NULL DEFAULT 0/);
  for (const source of [schema, migration]) {
    assert.match(source, /status TEXT NOT NULL DEFAULT 'pending'/);
    assert.match(source, /source TEXT NOT NULL/);
    assert.match(source, /admin_note TEXT NOT NULL DEFAULT ''/);
    assert.match(source, /idx_account_deletion_requests_one_active/);
    assert.match(source, /WHERE status IN \('pending','in_review'\)/);
  }
});

test('migration aggregates completed request counts then deletes all completed per-request records', () => {
  assert.match(anonymizationMigration, /CREATE TABLE IF NOT EXISTS account_deletion_summary/);
  assert.match(anonymizationMigration, /INSERT INTO account_deletion_summary \(id,completed_count,latest_completed_at\)/);
  assert.match(anonymizationMigration, /FROM account_deletion_requests\s+WHERE status='completed'\s+HAVING COUNT\(\*\) > 0/);
  assert.match(anonymizationMigration, /DELETE FROM account_deletion_requests WHERE status='completed'/);
  assert.match(accountDeletion, /INSERT INTO account_deletion_summary \(id,completed_count,latest_completed_at\)/);
  assert.match(accountDeletion, /DELETE FROM account_deletion_requests WHERE id=\? AND customer_id=\? AND status='in_review'/);
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
