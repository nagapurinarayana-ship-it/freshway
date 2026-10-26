import test from 'node:test';
import assert from 'node:assert/strict';
import { orders, updateOrder } from '../src/admin-orders.js';

function fixture({ testFlag = 0 } = {}) {
  const calls = [];
  const row = {
    id: 'FW-TEST-1', customer_id: 'cust-test', customer_name: 'Sample Test', customer_phone: '911234567890',
    is_test_order: testFlag, total: 120, payment_status: 'Not Collected', delivery_status: 'New',
    delivery_plan: 'Tomorrow', created_at: '2026-10-18 10:00:00', updated_at: '2026-10-18 10:00:00',
    payment_collected_at: null, house: '1', area: 'Test Road', city: 'Hyderabad', pincode: '500001', landmark: '', note: ''
  };
  const DB = {
    prepare(sql) {
      const call = { sql, binds: [] }; calls.push(call);
      return {
        bind(...binds) {
          call.binds = binds;
          return {
            async first() {
              if (sql.includes('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order')) {
                return { delivery_status: row.delivery_status, payment_status: row.payment_status, delivery_plan: row.delivery_plan, customer_id: row.customer_id, is_test_order: row.is_test_order };
              }
              if (sql.includes('COUNT(*)')) return { count: 1 };
              return null;
            },
            async all() {
              if (sql.includes('SELECT COUNT(*) count')) return { results: [{ count: 1 }] };
              if (sql.includes('SELECT o.id')) return { results: [{ ...row }] };
              if (sql.includes('SELECT order_id')) return { results: [{ order_id: row.id, product_id: 'rice', name: 'Rice', unit: 'kg', qty: 1, price: 120, line_total: 120 }] };
              return { results: [] };
            },
            async run() {
              if (sql.startsWith('UPDATE orders SET')) {
                const setClause = sql.slice('UPDATE orders SET '.length, sql.indexOf(' WHERE '));
                let index = 0;
                for (const field of ['delivery_status', 'payment_status', 'delivery_plan', 'is_test_order']) {
                  if (setClause.includes(field + '=?')) row[field] = binds[index++];
                }
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
  return { env: { DB }, calls, row };
}

test('owner live-order query explicitly excludes test orders', async () => {
  const { env, calls } = fixture();
  const result = await orders(env, new URL('https://example.test/api/admin/orders'));
  assert.equal(result.orders[0].isTestOrder, false);
  assert.ok(calls.some(call => call.sql.includes('o.is_test_order=0')));
});

test('owner Test Orders query selects only classified test orders', async () => {
  const { env, calls } = fixture({ testFlag: 1 });
  const result = await orders(env, new URL('https://example.test/api/admin/orders?testOrders=1'));
  assert.equal(result.orders[0].isTestOrder, true);
  assert.ok(calls.some(call => call.sql.includes('o.is_test_order=1')));
});

test('normal delivery status updates guard only the delivery status field', async () => {
  const { env, calls, row } = fixture();
  const result = await updateOrder(env, 'FW-TEST-1', { status: 'Confirmed' });
  assert.equal(result.status, 'Confirmed');
  assert.equal(result.isTestOrder, 0);
  assert.equal(result.testClassificationChanged, false);
  const update = calls.find(call => call.sql.startsWith('UPDATE orders SET'));
  assert.ok(update);
  assert.match(update.sql, /WHERE id=\? AND delivery_status IS \?/);
  assert.doesNotMatch(update.sql, /payment_status IS|delivery_plan IS|is_test_order IS/);
  assert.deepEqual(update.binds, ['Confirmed', 'FW-TEST-1', 'New']);
  assert.equal(row.delivery_status, 'Confirmed');
});

test('Owner can classify a test order without changing its delivery or payment status', async () => {
  const { env, calls, row } = fixture();
  const result = await updateOrder(env, 'FW-TEST-1', { isTestOrder: true });
  assert.equal(result.isTestOrder, 1);
  assert.equal(result.testClassificationChanged, true);
  const update = calls.find(call => call.sql.startsWith('UPDATE orders SET'));
  assert.ok(update);
  assert.match(update.sql, /^UPDATE orders SET is_test_order=\?,updated_at=CURRENT_TIMESTAMP WHERE id=\? AND is_test_order IS \?$/);
  assert.deepEqual(update.binds, [1, 'FW-TEST-1', 0]);
  assert.equal(row.is_test_order, 1);
});
