import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import adminWorker from '../src/admin-auth.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function fixture() {
  const row = {
    id: 'FW-TEST-POST-COMMIT',
    customer_id: 'customer-test',
    delivery_status: 'New',
    payment_status: 'Not Collected',
    delivery_plan: 'Tomorrow',
    is_test_order: 0
  };
  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.startsWith('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order FROM orders')) {
            return { ...row };
          }
          if (sql.startsWith('SELECT customer_id,delivery_status,payment_status,delivery_plan FROM orders')) {
            return { customer_id: row.customer_id, delivery_status: row.delivery_status, payment_status: row.payment_status, delivery_plan: row.delivery_plan };
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (sql.startsWith('UPDATE orders SET')) {
            const setClause = sql.slice('UPDATE orders SET '.length, sql.indexOf(' WHERE '));
            let index = 0;
            for (const field of ['delivery_status', 'payment_status', 'delivery_plan', 'is_test_order']) {
              if (setClause.includes(field + '=?')) row[field] = statement.values[index++];
            }
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { DB, row };
}

function adminSession(secret) {
  const issued = String(Math.floor(Date.now() / 1000));
  return issued + '.' + createHmac('sha256', secret).update(issued).digest('hex');
}

async function patchOrder(payload) {
  const secret = 'test-admin-session-secret';
  const { DB, row } = fixture();
  const pending = [];
  const env = {
    DB,
    ADMIN_SESSION_SECRET: secret,
    APP_ORIGIN: 'https://fwcoldpressed.in',
    APP_ORIGINS: 'https://fwcoldpressed.in'
  };
  const request = new Request('https://fwcoldpressed.in/api/admin/orders/' + row.id, {
    method: 'PATCH',
    headers: {
      Origin: 'https://fwcoldpressed.in',
      'Content-Type': 'application/json',
      'X-FreshWay-Admin-Session': adminSession(secret)
    },
    body: JSON.stringify(payload)
  });
  const response = await adminWorker.fetch(request, env, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  return { response, row };
}

test('successful status PATCH returns 200 after the request body is consumed by the handler', async () => {
  const { response, row } = await patchOrder({ status: 'Delivered' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'Delivered');
  assert.equal(row.delivery_status, 'Delivered');
});

test('successful test-order classification PATCH returns 200 after the request body is consumed by the handler', async () => {
  const { response, row } = await patchOrder({ isTestOrder: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isTestOrder, 1);
  assert.equal(row.is_test_order, 1);
});
