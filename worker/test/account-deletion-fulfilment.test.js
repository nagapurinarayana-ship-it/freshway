import test from 'node:test';
import assert from 'node:assert/strict';
import { fulfillAccountDeletion } from '../src/account-deletion.js';

function fakeEnv({
  deletion = { id: 'req-1', customer_id: 'cust-1', phone_snapshot: '919999999999', status: 'in_review' },
  customer = { id: 'cust-1', phone: '919999999999', deleted_at: null },
  completionChanges = 1
} = {}) {
  const prepared = [];
  let batchStatements = null;
  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() {
          if (sql.startsWith('SELECT id,customer_id,phone_snapshot,status')) return deletion;
          if (sql.startsWith('SELECT id,phone,deleted_at')) return customer;
          throw new Error('Unexpected SQL first(): ' + sql);
        }
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      batchStatements = statements;
      return statements.map((statement, index) => ({
        meta: { changes: completionChanges === 0 ? 0 : index === statements.length - 1 ? completionChanges : 1 }
      }));
    }
  };
  return { env: { DB }, prepared, get batchStatements() { return batchStatements; } };
}

const retentionNote = 'Account redacted; invoice buyer snapshots retained for tax and accounting retention.';

test('requires an explicit invoice retention decision before touching data', async () => {
  const fake = fakeEnv();
  const result = await fulfillAccountDeletion(fake.env, 'req-1', 'Deletion done');
  assert.equal(result.status, 400);
  assert.equal(fake.prepared.length, 0);
  assert.equal(fake.batchStatements, null);
});

test('redacts operational personal data, revokes access and retains issued invoice snapshots', async () => {
  const fake = fakeEnv();
  const result = await fulfillAccountDeletion(fake.env, 'req-1', retentionNote);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.alreadyCompleted, false);
  const statements = fake.batchStatements;
  assert.ok(Array.isArray(statements));
  const sql = statements.map(statement => statement.sql);
  assert.ok(sql.some(statement => statement.startsWith('DELETE FROM push_subscriptions')));
  assert.ok(sql.some(statement => statement.startsWith('DELETE FROM notification_events')));
  assert.ok(sql.some(statement => statement.startsWith('UPDATE order_address_snapshots SET customer_id=NULL')));
  assert.ok(sql.some(statement => statement.startsWith("UPDATE addresses SET house='Removed'")));
  assert.ok(sql.some(statement => statement.startsWith("UPDATE orders SET customer_name='Deleted customer'")));
  assert.ok(sql.some(statement => statement.startsWith('UPDATE customers SET name=NULL,phone=NULL,passcode_salt=NULL,passcode_hash=NULL')));
  assert.ok(sql.some(statement => statement.startsWith("UPDATE account_deletion_requests SET status='completed',customer_id=NULL,phone_snapshot='REDACTED'")));
  assert.ok(sql.some(statement => statement.startsWith('DELETE FROM auth_rate_limits WHERE key IN (?,?,?,?,?,?)')));
  assert.equal(sql.some(statement => /^\s*(DELETE FROM customers|UPDATE invoices)\b/i.test(statement)), false);
  assert.ok(statements.some(statement => statement.sql.startsWith('DELETE FROM auth_rate_limits') && statement.params.includes('auth:login:phone:919999999999')));
  assert.equal(statements.at(-1).sql.startsWith("UPDATE account_deletion_requests SET status='completed',customer_id=NULL,phone_snapshot='REDACTED'"), true);
  assert.match(statements.at(-1).sql, /admin_note='Completed: operational customer data redacted/);
  assert.deepEqual(statements.at(-1).params, ['req-1', 'cust-1'], 'customer-entered notes are not stored on completed audit rows');
});

test('guards every operational mutation against a request that is no longer in review', async () => {
  const fake = fakeEnv();
  await fulfillAccountDeletion(fake.env, 'req-1', retentionNote);
  const statements = fake.batchStatements;
  assert.ok(statements.length >= 7);
  for (const statement of statements) {
    assert.match(statement.sql, /EXISTS \(SELECT 1 FROM account_deletion_requests WHERE id=\? AND customer_id=\? AND status='in_review'\)|UPDATE account_deletion_requests SET status='completed'[\s\S]*WHERE id=\? AND customer_id=\? AND status='in_review'/);
  }
});

test('returns conflict if a concurrent Owner action changed the request before commit', async () => {
  const fake = fakeEnv({ completionChanges: 0 });
  const result = await fulfillAccountDeletion(fake.env, 'req-1', retentionNote);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(fake.batchStatements.at(-1).sql.startsWith("UPDATE account_deletion_requests SET status='completed'"), true);
});

test('does not issue a wildcard rate-limit delete when the saved phone is absent', async () => {
  const fake = fakeEnv({
    deletion: { id: 'req-2', customer_id: 'cust-2', phone_snapshot: 'REDACTED', status: 'in_review' },
    customer: { id: 'cust-2', phone: null, deleted_at: null }
  });
  const result = await fulfillAccountDeletion(fake.env, 'req-2', retentionNote);
  assert.equal(result.status, 'completed');
  assert.equal(fake.batchStatements.some(statement => statement.sql.startsWith('DELETE FROM auth_rate_limits')), false);
});

test('requires a request in review and handles already completed requests idempotently', async () => {
  const pending = fakeEnv({ deletion: { id: 'req-3', customer_id: 'cust-3', phone_snapshot: '919999999999', status: 'pending' } });
  const blocked = await fulfillAccountDeletion(pending.env, 'req-3', retentionNote);
  assert.equal(blocked.status, 409);
  assert.equal(pending.batchStatements, null);

  const completed = fakeEnv({ deletion: { id: 'req-4', customer_id: 'cust-4', phone_snapshot: 'REDACTED', status: 'completed' } });
  const repeated = await fulfillAccountDeletion(completed.env, 'req-4', retentionNote);
  assert.equal(repeated.alreadyCompleted, true);
  assert.equal(repeated.status, 'completed');
  assert.equal(completed.batchStatements, null);
});
