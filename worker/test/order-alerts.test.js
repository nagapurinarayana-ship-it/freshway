import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { buildOrderPlacedAlerts, dispatchOrderAlert, saveOwnerSubscription, deleteOwnerSubscription, listOwnerOrderAlerts, deleteOwnerOrderAlert, deleteAllOwnerOrderAlerts, getOwnerPushDiagnostics, sendOwnerPushTest } from '../src/order-alerts.js';
import { buildOrderChangeAlerts } from '../src/admin-notifications.js';

test('new order alerts tell the customer the order was received and alert the Owner separately', () => {
  const [customer, owner] = buildOrderPlacedAlerts({
    id: 'FW-12345678-ABC', customerId: 'customer-1', customerName: 'Narayana', total: 2238,
    items: [{ qty: 2 }, { qty: 1 }, { qty: 1 }]
  });
  assert.equal(customer.audience, 'customer');
  assert.match(customer.title, /Order received/i);
  assert.match(customer.body, /received order FW-12345678-ABC/i);
  assert.match(customer.body, /notify you when it’s confirmed/i);
  assert.doesNotMatch(customer.body, /is confirmed/i);
  assert.match(customer.url, /openOrder=FW-12345678-ABC#orders/);
  assert.equal(owner.audience, 'owner');
  assert.match(owner.title, /^OWNER · New FreshWay order/);
  assert.doesNotMatch(customer.title, /^OWNER/);
  assert.match(owner.body, /Narayana/);
  assert.match(owner.body, /₹2,238/);
  assert.match(owner.body, /4 items/);
  assert.match(owner.url, /\/admin\/\?openOrder=FW-12345678-ABC#orders/);
  assert.notEqual(customer.eventKey, owner.eventKey);
});

test('only real persisted status, payment, or delivery-plan transitions generate alerts for both sides', () => {
  const before = { customer_id: 'customer-1', delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow', is_test_order: 0 };
  const after = { ...before, delivery_status: 'Ready' };
  const alerts = buildOrderChangeAlerts('FW-1', before, after, 'test-transition');
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map(x => x.audience), ['customer', 'owner']);
  assert.doesNotMatch(alerts[0].title, /^OWNER/);
  assert.match(alerts[1].title, /^OWNER · Order status updated/);
  assert.match(alerts[0].body, /order FW-1 is ready/i);
  assert.doesNotMatch(alerts[0].body, /ready for delivery/i);
  assert.match(alerts[1].body, /New → Ready/);
  assert.equal(buildOrderChangeAlerts('FW-1', after, after, 'same-state').length, 0);

  const paymentAlerts = buildOrderChangeAlerts('FW-1', before, { ...before, payment_status: 'Collected' }, 'payment-transition');
  assert.equal(paymentAlerts.length, 2);
  assert.doesNotMatch(paymentAlerts[0].title, /^OWNER/);
  assert.match(paymentAlerts[1].title, /^OWNER · Order payment updated/);
  assert.match(paymentAlerts[0].body, /cash payment has been collected/i);
  const planAlerts = buildOrderChangeAlerts('FW-1', before, { ...before, delivery_plan: 'Today' }, 'plan-transition');
  assert.equal(planAlerts.length, 2);
  assert.doesNotMatch(planAlerts[0].title, /^OWNER/);
  assert.match(planAlerts[1].title, /^OWNER · Order delivery plan updated/);
  assert.match(planAlerts[0].body, /delivery plan.*Today/i);
});

test('test orders never emit customer or Owner alerts', () => {
  const order = { customer_id: 'customer-1', delivery_status: 'New', payment_status: 'Not Collected', delivery_plan: 'Tomorrow', is_test_order: 1 };
  assert.deepEqual(buildOrderChangeAlerts('FW-TEST', order, { ...order, delivery_status: 'Confirmed' }, 'test'), []);
});

test('alert event keys deduplicate duplicate dispatch attempts and absent VAPID credentials are recorded safely', async () => {
  const events = new Map();
  const updates = [];
  const env = {
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async run() {
            if (sql.includes('INSERT INTO notification_events')) {
              if (events.has(args[0])) return { meta: { changes: 0 } };
              const id = events.size + 1; events.set(args[0], { id, args }); return { meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE notification_events')) { updates.push(args); return { meta: { changes: 1 } }; }
            throw new Error('Unexpected SQL: ' + sql);
          },
          async first() { const v = events.get(args[0]); return v ? { id: v.id } : null; }
        };
      }
    }
  };
  const alert = { audience: 'owner', orderId: 'FW-2', eventType: 'new_order', eventKey: 'event-fw-2-owner', title: 'New order', body: 'FW-2 created', url: '/admin/#orders' };
  assert.equal((await dispatchOrderAlert(env, alert)).status, 'not_configured');
  assert.equal(events.size, 1);
  assert.equal((await dispatchOrderAlert(env, alert)).status, 'duplicate');
  assert.equal(events.size, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 'not_configured');
});

test('Owner alert history uses keyset pagination and deletion is restricted to Owner records', async () => {
  const statements = [];
  const env = { DB: { prepare(sql) {
    const statement = { sql, args: [], bind(...args) { this.args = args; return this; },
      async all() { statements.push({ sql: this.sql, args: this.args, kind: 'all' }); return { results: [{ id: 18 }, { id: 17 }] }; },
      async run() { statements.push({ sql: this.sql, args: this.args, kind: 'run' }); return { meta: { changes: this.sql.includes('WHERE id=') ? 1 : 3 } }; }
    };
    return statement;
  } } };

  const firstPage = await listOwnerOrderAlerts(env, 2);
  assert.deepEqual(firstPage.map(row => row.id), [18, 17]);
  assert.match(statements[0].sql, /audience='owner'/);
  assert.match(statements[0].sql, /ORDER BY id DESC LIMIT \?/);
  assert.deepEqual(statements[0].args, [2]);

  await listOwnerOrderAlerts(env, 20, 17);
  assert.match(statements[1].sql, /audience='owner' AND id < \?/);
  assert.deepEqual(statements[1].args, [17, 20]);
  await assert.rejects(() => listOwnerOrderAlerts(env, 20, '17 OR 1=1'), /Invalid Owner alert cursor/);

  assert.deepEqual(await deleteOwnerOrderAlert(env, 18), { ok: true, deleted: 1 });
  assert.match(statements[2].sql, /DELETE FROM notification_events WHERE id=\? AND audience='owner'/);
  assert.deepEqual(statements[2].args, [18]);
  await assert.rejects(() => deleteOwnerOrderAlert(env, '18 OR 1=1'), /Invalid Owner alert id/);

  assert.deepEqual(await deleteAllOwnerOrderAlerts(env), { ok: true, deleted: 3 });
  assert.match(statements[3].sql, /DELETE FROM notification_events WHERE audience='owner'/);
  assert.doesNotMatch(statements[3].sql, /customer/i);
});

test('stored unsupported push endpoints are never contacted and are removed', async () => {
  const originalSetVapidDetails = webpush.setVapidDetails;
  const originalSendNotification = webpush.sendNotification;
  let sends = 0;
  const sqlCalls = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async () => { sends += 1; };
  const env = {
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:ops@example.test',
    DB: {
      prepare(sql) {
        sqlCalls.push(sql);
        return {
          args: [],
          bind(...args) { this.args = args; return this; },
          async run() {
            if (sql.includes('INSERT INTO notification_events')) return { meta: { changes: 1 } };
            if (sql.startsWith('UPDATE notification_events')) return { meta: { changes: 1 } };
            throw new Error('Unexpected run(): ' + sql);
          },
          async first() {
            if (sql.includes('SELECT id FROM notification_events')) return { id: 41 };
            throw new Error('Unexpected first(): ' + sql);
          },
          async all() {
            if (sql.includes('SELECT endpoint,p256dh,auth FROM push_subscriptions')) {
              return { results: [{ endpoint: 'https://attacker.example/internal-target', p256dh: 'p256dh', auth: 'auth' }] };
            }
            throw new Error('Unexpected all(): ' + sql);
          }
        };
      },
      async batch(statements) {
        sqlCalls.push(...statements.map(statement => statement.sql));
        return statements.map(() => ({ meta: { changes: 1 } }));
      }
    }
  };
  try {
    const result = await dispatchOrderAlert(env, {
      audience: 'customer',
      customerId: 'customer-1',
      orderId: 'FW-TEST-1',
      eventType: 'order_update',
      eventKey: 'test-invalid-push-endpoint',
      title: 'Test alert',
      body: 'Test message',
      url: '/orders'
    });
    assert.equal(sends, 0, 'unsupported saved endpoint must not receive a network request');
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.status, 'failed');
    assert.ok(sqlCalls.some(sql => sql.includes('DELETE FROM push_subscriptions WHERE endpoint=?')));
  } finally {
    webpush.setVapidDetails = originalSetVapidDetails;
    webpush.sendNotification = originalSendNotification;
  }
});

test('Owner push subscription writes are scoped to the Owner partition and validate secure endpoints', async () => {
  const statements = [];
  const env = { DB: { prepare(sql) { return { bind(...args) { statements.push({ sql, args }); return this; }, async run() { return { meta: { changes: 1 } }; } }; } } };
  const subscription = { subscription: { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-subscription', keys: { p256dh: 'p256dh', auth: 'auth' }, expirationTime: null } };
  assert.deepEqual(await saveOwnerSubscription(env, subscription), { ok: true });
  assert.match(statements[0].sql, /owner_push_subscriptions/);
  assert.match(statements[0].sql, /owner_key/);
  assert.equal(statements[0].args[0], 'https://updates.push.services.mozilla.com/wpush/v2/test-subscription');
  await assert.rejects(() => saveOwnerSubscription(env, { subscription: { ...subscription.subscription, endpoint: 'http://bad.example/sub' } }), /Invalid push endpoint/);
  await assert.rejects(() => saveOwnerSubscription(env, { subscription: { ...subscription.subscription, endpoint: 'https://attacker.example/sub' } }), /supported browser push services/);
  assert.equal(statements.length, 1, 'unsupported endpoints must be rejected before database writes');
  assert.deepEqual(await deleteOwnerSubscription(env, { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-subscription' }), { ok: true });
});


test('Owner push diagnostics expose subscription counts and latest safe delivery result', async () => {
  const env = {
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
    VAPID_SUBJECT: 'mailto:ops@example.test',
    DB: { prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('COUNT(*)')) return { count: 2 };
          if (sql.includes('notification_events')) {
            return { event_type: 'new_order', status: 'failed', recipient_count: 2, success_count: 0,
              failure_count: 2, last_error: 'HTTP_403:2', created_at: '2026-10-21 12:00:00', updated_at: '2026-10-21 12:00:01' };
          }
          throw new Error('Unexpected SQL: ' + sql);
        }
      };
    } }
  };
  const result = await getOwnerPushDiagnostics(env);
  assert.equal(result.pushConfigured, true);
  assert.equal(result.ownerSubscriptionCount, 2);
  assert.equal(result.latestAlert.status, 'failed');
  assert.equal(result.latestAlert.last_error, 'HTTP_403:2');
  assert.equal(Object.hasOwn(result, 'publicKey'), false, 'diagnostics must not return VAPID keys');
});

test('Owner test push records an actionable not-configured result without failing', async () => {
  const events = new Map();
  const updates = [];
  const env = {
    DB: { prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (sql.includes('INSERT INTO notification_events')) {
            const id = events.size + 1;
            events.set(args[0], { id, event_type: args[4], status: 'sending', args });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE notification_events')) {
            updates.push(args);
            const event = [...events.values()][0];
            event.status = args[0];
            event.last_error = args[4];
            event.recipient_count = args[1];
            event.success_count = args[2];
            event.failure_count = args[3];
            return { meta: { changes: 1 } };
          }
          throw new Error('Unexpected SQL: ' + sql);
        },
        async first() {
          if (sql.includes('SELECT id FROM notification_events')) return events.get(args[0]) ? { id: events.get(args[0]).id } : null;
          if (sql.includes('COUNT(*)')) return { count: 0 };
          if (sql.includes('notification_events')) {
            const event = [...events.values()][0];
            return event ? { event_type: event.event_type, status: event.status, recipient_count: event.recipient_count,
              success_count: event.success_count, failure_count: event.failure_count, last_error: event.last_error } : null;
          }
          throw new Error('Unexpected SQL: ' + sql);
        }
      };
    } }
  };
  const result = await sendOwnerPushTest(env);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.ownerSubscriptionCount, 0);
  assert.equal(result.lastError, 'PUSH_NOT_CONFIGURED');
  assert.equal(events.size, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 'not_configured');
});
