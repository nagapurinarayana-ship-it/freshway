import test from 'node:test';
import assert from 'node:assert/strict';
import { updateOrder } from '../src/admin-orders.js';

function fixture({ status = 'New', reservedQty = 2, stockQuantity = 3 } = {}) {
  const order = {
    id: 'FW-INVENTORY-1',
    delivery_status: status,
    payment_status: 'Not Collected',
    delivery_plan: 'Tomorrow',
    customer_id: 'customer-test',
    is_test_order: 0
  };
  const items = [{ order_id: order.id, product_id: 'p1', qty: 2, stock_reserved_qty: reservedQty }];
  const products = new Map([['p1', { id: 'p1', name: 'Rice', stock_managed: 1, stock_quantity: stockQuantity }]]);
  const calls = [];
  const batches = [];

  function evaluate(sql, args, state) {
    calls.push({ sql, args });
    if (sql.startsWith('INSERT INTO order_audit_events') || sql.startsWith('INSERT INTO order_operational_flags')) return { meta: { changes: 1 } };
    if (sql.startsWith('UPDATE products SET stock_quantity=stock_quantity+?')) {
      const [qty, productId] = args;
      const p = state.products.get(productId);
      if (!p || Number(p.stock_managed) !== 1) return { meta: { changes: 0 } };
      p.stock_quantity += Number(qty);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE products SET stock_quantity=stock_quantity-?')) {
      const [qty, productId] = args;
      const p = state.products.get(productId);
      if (!p || Number(p.stock_managed) !== 1) return { meta: { changes: 0 } };
      if (p.stock_quantity < Number(qty)) throw new Error('CHECK constraint failed: stock_quantity >= 0');
      p.stock_quantity -= Number(qty);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE order_items SET stock_reserved_qty=0')) {
      const orderId = args[0];
      let changes = 0;
      for (const item of state.items) {
        if (item.order_id === orderId && item.stock_reserved_qty > 0) {
          item.stock_reserved_qty = 0;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (sql.startsWith('UPDATE order_items SET stock_reserved_qty=qty')) {
      const [orderId, productId] = args;
      let changes = 0;
      for (const item of state.items) {
        if (item.order_id === orderId && item.product_id === productId && item.stock_reserved_qty === 0) {
          item.stock_reserved_qty = item.qty;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (sql.startsWith('UPDATE orders SET')) {
      const setClause = sql.slice('UPDATE orders SET '.length, sql.indexOf(' WHERE '));
      const argsForSets = [];
      let setBindCount = 0;
      for (const assignment of setClause.split(',')) {
        if (assignment.includes('=?')) {
          argsForSets.push([assignment.split('=')[0], args[setBindCount]]);
          setBindCount++;
        }
      }
      const whereParams = args.slice(setBindCount);
      let guardIndex = 0;
      if (whereParams[guardIndex++] !== state.order.id) return { meta: { changes: 0 } };
      for (const field of ['delivery_status', 'payment_status', 'delivery_plan', 'is_test_order']) {
        if (sql.includes(field + ' IS ?')) {
          if (state.order[field] !== whereParams[guardIndex++]) return { meta: { changes: 0 } };
        }
      }
      for (const [field, value] of argsForSets) state.order[field] = value;
      return { meta: { changes: 1 } };
    }
    throw new Error('Unexpected SQL: ' + sql);
  }

  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.startsWith('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order')) {
            return { ...order };
          }
          throw new Error('Unexpected first(): ' + sql);
        },
        async all() {
          if (sql.includes('SUM(stock_reserved_qty) AS reserved_qty')) {
            const sums = new Map();
            for (const item of items) {
              if (item.order_id === order.id && item.stock_reserved_qty > 0) {
                sums.set(item.product_id, (sums.get(item.product_id) || 0) + item.stock_reserved_qty);
              }
            }
            return { results: [...sums].map(([product_id, reserved_qty]) => ({ product_id, reserved_qty })) };
          }
          if (sql.includes('SUM(CASE WHEN oi.stock_reserved_qty=0 THEN oi.qty ELSE 0 END)')) {
            const sums = new Map();
            for (const item of items) {
              const product = products.get(item.product_id);
              if (item.order_id === order.id && item.stock_reserved_qty === 0 && product?.stock_managed === 1) {
                const row = sums.get(item.product_id) || {
                  product_id: item.product_id,
                  reserve_qty: 0,
                  available_stock: product.stock_quantity,
                  product_name: product.name
                };
                row.reserve_qty += item.qty;
                row.available_stock = product.stock_quantity;
                sums.set(item.product_id, row);
              }
            }
            return { results: [...sums.values()] };
          }
          throw new Error('Unexpected all(): ' + sql);
        },
        async run() {
          return evaluate(sql, statement.args, { order, items, products });
        }
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements.map(statement => ({ sql: statement.sql, args: statement.args })));
      const state = {
        order: { ...order },
        items: items.map(item => ({ ...item })),
        products: new Map([...products.entries()].map(([key, value]) => [key, { ...value }]))
      };
      const result = [];
      for (const statement of statements) result.push(evaluate(statement.sql, statement.args, state));
      Object.assign(order, state.order);
      items.splice(0, items.length, ...state.items);
      products.clear();
      for (const [key, value] of state.products) products.set(key, value);
      return result;
    }
  };

  return { env: { DB }, order, items, products, calls, batches };
}

test('cancelling a live order atomically restores reserved stock and clears reservation markers once', async () => {
  const f = fixture({ status: 'New', reservedQty: 2, stockQuantity: 3 });
  const result = await updateOrder(f.env, f.order.id, { status: 'Cancelled' });

  assert.equal(result.status, 'Cancelled');
  assert.equal(f.order.delivery_status, 'Cancelled');
  assert.equal(f.products.get('p1').stock_quantity, 5);
  assert.equal(f.items[0].stock_reserved_qty, 0);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].length, 3);
  assert.match(f.batches[0][0].sql, /stock_quantity=stock_quantity\+\?/);
  assert.match(f.batches[0][1].sql, /UPDATE order_items SET stock_reserved_qty=0/);
  assert.match(f.batches[0][2].sql, /UPDATE orders SET/);
  assert.ok(f.batches[0].slice(0, 2).every(statement => /EXISTS\(SELECT 1 FROM orders o WHERE o\.id=\? AND o\.delivery_status IS \?/.test(statement.sql)));
  assert.match(f.batches[0][2].sql, /WHERE id=\? AND delivery_status IS \?/);

  await updateOrder(f.env, f.order.id, { status: 'Cancelled' });
  assert.equal(f.products.get('p1').stock_quantity, 5, 'repeating cancellation must not restore stock twice');
});

test('reopening a cancelled order reserves tracked inventory in the same batch as the order update', async () => {
  const f = fixture({ status: 'Cancelled', reservedQty: 0, stockQuantity: 5 });
  const result = await updateOrder(f.env, f.order.id, { status: 'Confirmed' });

  assert.equal(result.status, 'Confirmed');
  assert.equal(f.order.delivery_status, 'Confirmed');
  assert.equal(f.products.get('p1').stock_quantity, 3);
  assert.equal(f.items[0].stock_reserved_qty, 2);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].length, 3);
  assert.match(f.batches[0][0].sql, /stock_quantity=stock_quantity-\?/);
  assert.match(f.batches[0][1].sql, /UPDATE order_items SET stock_reserved_qty=qty/);
  assert.match(f.batches[0][2].sql, /UPDATE orders SET/);
});

test('reopening a cancelled order with insufficient stock makes no changes', async () => {
  const f = fixture({ status: 'Cancelled', reservedQty: 0, stockQuantity: 1 });

  await assert.rejects(
    () => updateOrder(f.env, f.order.id, { status: 'Confirmed' }),
    /ORDER_CONFLICT: Not enough stock to reopen this cancelled order/i
  );
  assert.equal(f.order.delivery_status, 'Cancelled');
  assert.equal(f.products.get('p1').stock_quantity, 1);
  assert.equal(f.items[0].stock_reserved_qty, 0);
  assert.equal(f.batches.length, 0);
});

test('cancelling an already delivered order does not restore fulfilled inventory', async () => {
  const f = fixture({ status: 'Delivered', reservedQty: 2, stockQuantity: 3 });
  const result = await updateOrder(f.env, f.order.id, { status: 'Cancelled' });

  assert.equal(result.status, 'Cancelled');
  assert.equal(f.products.get('p1').stock_quantity, 3);
  assert.equal(f.items[0].stock_reserved_qty, 2);
  assert.equal(f.batches.length, 0);
});

test('reopening a legacy cancelled order with its old reservation marker does not reserve stock twice', async () => {
  const f = fixture({ status: 'Cancelled', reservedQty: 2, stockQuantity: 3 });
  await updateOrder(f.env, f.order.id, { status: 'Confirmed' });
  assert.equal(f.products.get('p1').stock_quantity, 3);
  assert.equal(f.items[0].stock_reserved_qty, 2);
  assert.equal(f.order.delivery_status, 'Confirmed');
  assert.equal(f.batches.length, 0);
});
