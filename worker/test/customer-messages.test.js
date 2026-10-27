import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCustomerMessage,
  listCustomerMessages,
  unreadCustomerMessageCount,
  markCustomerMessagesRead,
  listAdminCustomerMessages,
  replyToCustomerMessage,
  cleanupExpiredCustomerMessages,
  handleCustomerMessages
} from '../src/customer-messages.js';

const CUSTOMER_ID = 'customer-1';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = 'request-00000000-0000-4000-8000-000000000002';

function fakeEnv(options = {}) {
  const calls = [];
  const customer = options.customer === undefined
    ? { id: CUSTOMER_ID, name: 'Test Customer', phone: '+91 98765 43210' }
    : options.customer;
  const message = options.message === undefined
    ? { id: MESSAGE_ID, customer_id: CUSTOMER_ID, status: 'pending', admin_reply: null }
    : options.message;
  const requestRow = options.requestRow === undefined
    ? { id: REQUEST_ID, customer_id: CUSTOMER_ID, admin_reply: null }
    : options.requestRow;
  const generalRows = options.generalRows || [{
    id: MESSAGE_ID, subject: 'Delivery question', message: 'When will this arrive?',
    status: 'replied', admin_reply: 'Your order is scheduled.', created_at: '2026-10-27T10:00:00.000Z',
    updated_at: '2026-10-27T10:30:00.000Z', replied_at: '2026-10-27T10:30:00.000Z',
    reply_seen_at: null, source: 'message', order_id: null
  }];
  const orderRows = options.orderRows || [{
    id: REQUEST_ID, subject: 'Order help · FW-123', message: 'Please help with my order.',
    status: 'pending', admin_reply: null, created_at: '2026-10-27T09:00:00.000Z',
    updated_at: '2026-10-27T09:00:00.000Z', replied_at: null, reply_seen_at: null,
    source: 'order_request', order_id: 'FW-123'
  }];

  const resultFor = (sql, args = []) => {
    if (/SELECT id,name,phone FROM customers/i.test(sql)) return customer;
    if (/SELECT id,customer_id,status,admin_reply FROM customer_messages/i.test(sql)) return message;
    if (/SELECT id,customer_id,admin_reply FROM order_action_requests/i.test(sql)) return requestRow;
    if (/SELECT id FROM notification_events WHERE event_key/i.test(sql)) return { id: 'notification-event-1' };
    if (/COUNT\(\*\) AS total/i.test(sql)) {
      if (/created_at >= strftime/i.test(sql)) return { total: options.dailyCount ?? 0 };
      if (/reply_seen_at IS NULL/i.test(sql) && /FROM customer_messages/i.test(sql)) return { total: options.unreadMessages ?? 2 };
      if (/reply_seen_at IS NULL/i.test(sql) && /FROM order_action_requests/i.test(sql)) return { total: options.unreadOrderReplies ?? 1 };
      if (/FROM customer_messages WHERE customer_id=/i.test(sql)) return { total: options.customerMessageCount ?? 0 };
      if (/FROM customer_messages WHERE expires_at/i.test(sql)) return { total: options.globalMessageCount ?? 0 };
      return { total: 0 };
    }
    return null;
  };

  const DB = {
    prepare(sql) {
      const statement = {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async run() {
          calls.push({ sql: this.sql, args: this.args, method: 'run' });
          if (/INSERT INTO notification_events/i.test(this.sql)) return { meta: { changes: 1 } };
          if (/UPDATE notification_events/i.test(this.sql)) return { meta: { changes: 1 } };
          return { meta: { changes: 0 } };
        },
        async first() {
          calls.push({ sql: this.sql, args: this.args, method: 'first' });
          return resultFor(this.sql, this.args);
        },
        async all() {
          calls.push({ sql: this.sql, args: this.args, method: 'all' });
          if (/FROM customer_messages/i.test(this.sql) && /SELECT id,subject,message,status/i.test(this.sql)) return { results: generalRows };
          if (/FROM order_action_requests r/i.test(this.sql)) return { results: orderRows };
          if (/SELECT status,COUNT\(\*\) AS total FROM customer_messages/i.test(this.sql)) return { results: [{ status: 'pending', total: 1 }, { status: 'replied', total: 2 }] };
          if (/SELECT CASE WHEN admin_reply/i.test(this.sql)) return { results: [{ status: 'pending', total: 1 }, { status: 'replied', total: 1 }] };
          if (/SELECT id FROM customer_messages/i.test(this.sql)) return { results: [] };
          return { results: [] };
        }
      };
      return statement;
    },
    async batch(statements) {
      calls.push({ method: 'batch', count: statements.length });
      return Promise.all(statements.map(statement => statement.run()));
    }
  };
  return { DB, calls };
}

test('rejects short or oversized subjects and messages before database writes', async () => {
  const env = fakeEnv();
  await assert.rejects(createCustomerMessage(env, CUSTOMER_ID, { subject: 'x', message: 'hello there' }), error => error.status === 400 && /subject/i.test(error.message));
  await assert.rejects(createCustomerMessage(env, CUSTOMER_ID, { subject: 'Delivery issue', message: 'tiny' }), error => error.status === 400 && /message/i.test(error.message));
  await assert.rejects(createCustomerMessage(env, CUSTOMER_ID, { subject: 'x'.repeat(121), message: 'hello there' }), error => error.status === 400);
  await assert.rejects(createCustomerMessage(env, CUSTOMER_ID, { subject: 'Valid subject', message: 'x'.repeat(2001) }), error => error.status === 400);
  assert.equal(env.calls.filter(call => /INSERT INTO customer_messages/i.test(call.sql || '')).length, 0);
});

test('stores a valid customer message and uses a privacy-safe Owner push', async () => {
  const env = fakeEnv();
  const result = await createCustomerMessage(env, CUSTOMER_ID, { subject: '  Delivery question  ', message: '  Can you confirm my delivery?  ' });
  assert.equal(result.ok, true);
  assert.match(result.id, /^[a-f0-9-]{36}$/i);
  assert.match(result.message, /Profile → Messages/);
  const insert = env.calls.find(call => /INSERT INTO customer_messages/i.test(call.sql));
  assert.ok(insert, 'message must be persisted before returning success');
  assert.deepEqual(insert.args.slice(1, 6), [CUSTOMER_ID, 'Test Customer', '3210', 'Delivery question', 'Can you confirm my delivery?']);
  const ownerEvent = env.calls.find(call => /INSERT INTO notification_events/i.test(call.sql));
  assert.ok(ownerEvent, 'new message should create an Owner notification event');
  assert.equal(ownerEvent.args[1], 'owner');
  assert.equal(ownerEvent.args[4], 'customer_message_new');
  assert.equal(ownerEvent.args[6], 'Open Owner Admin to read and reply.');
  assert.doesNotMatch(ownerEvent.args[6], /Delivery question|Can you confirm/);
});

test('requires the authenticated customer record and enforces the daily submission cap', async () => {
  const noCustomer = fakeEnv({ customer: null });
  await assert.rejects(createCustomerMessage(noCustomer, CUSTOMER_ID, { subject: 'Delivery question', message: 'Please check this.' }), error => error.status === 401);
  const rateLimited = fakeEnv({ dailyCount: 5 });
  await assert.rejects(createCustomerMessage(rateLimited, CUSTOMER_ID, { subject: 'Delivery question', message: 'Please check this.' }), error => error.status === 429 && /limit/i.test(error.message));
  assert.equal(rateLimited.calls.some(call => /INSERT INTO customer_messages/i.test(call.sql || '')), false);
});

test('customer inbox combines private general messages and order-help replies', async () => {
  const env = fakeEnv();
  const messages = await listCustomerMessages(env, CUSTOMER_ID);
  assert.equal(messages.length, 2);
  assert.ok(messages.some(item => item.source === 'message' && item.admin_reply === 'Your order is scheduled.'));
  assert.ok(messages.some(item => item.source === 'order_request' && item.order_id === 'FW-123'));
  for (const call of env.calls.filter(item => item.method === 'all')) assert.deepEqual(call.args, [CUSTOMER_ID]);
  const orderQuery = env.calls.find(call => /FROM order_action_requests r/i.test(call.sql));
  assert.match(orderQuery.sql, /r\.status IN \('pending','approved'\)/);
  assert.match(orderQuery.sql, /r\.replied_at >= strftime/);
});

test('unread reply count combines general-message and order-help replies and marks both read', async () => {
  const env = fakeEnv({ unreadMessages: 2, unreadOrderReplies: 1 });
  assert.equal(await unreadCustomerMessageCount(env, CUSTOMER_ID), 3);
  const result = await markCustomerMessagesRead(env, CUSTOMER_ID);
  assert.equal(result.ok, true);
  assert.equal(result.markedRead, 0);
  const readStatements = env.calls.filter(call => call.method === 'batch');
  assert.equal(readStatements.length, 1);
  const callsToRead = env.calls.filter(call => /UPDATE (customer_messages|order_action_requests) SET reply_seen_at/i.test(call.sql || ''));
  assert.equal(callsToRead.length, 2);
});

test('Owner inbox can list all threads and reply to a general customer message', async () => {
  const env = fakeEnv();
  const list = await listAdminCustomerMessages(env, 'all');
  assert.equal(list.status, 'all');
  assert.equal(list.summary.pending, 2);
  assert.equal(list.summary.replied, 3);
  assert.ok(list.messages.some(item => item.source === 'message'));
  assert.ok(list.messages.some(item => item.source === 'order_request'));
  const reply = await replyToCustomerMessage(env, MESSAGE_ID, { reply: 'Your delivery is scheduled for tomorrow.' });
  assert.equal(reply.ok, true);
  assert.equal(reply.notification.status, 'not_configured');
  const update = env.calls.find(call => /UPDATE customer_messages SET status='replied'/i.test(call.sql || ''));
  assert.equal(update.args[0], 'Your delivery is scheduled for tomorrow.');
  const notification = env.calls.filter(call => /INSERT INTO notification_events/i.test(call.sql));
  assert.ok(notification.length >= 1);
  assert.equal(notification.at(-1).args[6], 'Open FreshWay to read your reply.');
});

test('Owner can reply to an order-help request but cannot reply for a deleted customer', async () => {
  const env = fakeEnv();
  const result = await replyToCustomerMessage(env, REQUEST_ID, { reply: 'We have resolved your order issue.' });
  assert.equal(result.ok, true);
  const update = env.calls.find(call => /UPDATE order_action_requests SET admin_reply/i.test(call.sql || ''));
  assert.equal(update.args[0], 'We have resolved your order issue.');
  const deleted = fakeEnv({ requestRow: { id: REQUEST_ID, customer_id: null, admin_reply: null } });
  await assert.rejects(replyToCustomerMessage(deleted, REQUEST_ID, { reply: 'Please read this.' }), error => error.status === 409);
  assert.equal(deleted.calls.some(call => /UPDATE order_action_requests SET admin_reply/i.test(call.sql || '')), false);
});

test('validates IDs and reply lengths before accessing customer data', async () => {
  const env = fakeEnv();
  await assert.rejects(replyToCustomerMessage(env, 'not-an-id', { reply: 'Hello there' }), error => error.status === 400);
  await assert.rejects(replyToCustomerMessage(env, MESSAGE_ID, { reply: 'x' }), error => error.status === 400);
  await assert.rejects(replyToCustomerMessage(env, MESSAGE_ID, { reply: 'x'.repeat(2001) }), error => error.status === 400);
  assert.equal(env.calls.length, 0);
});

test('runs retention cleanup and clears only expired support replies, not orders', async () => {
  const env = fakeEnv();
  const result = await cleanupExpiredCustomerMessages(env);
  assert.equal(result.messagesDeleted, 0);
  assert.ok(env.calls.some(call => /DELETE FROM customer_messages WHERE expires_at <=/i.test(call.sql || '')));
  assert.ok(env.calls.some(call => /UPDATE order_action_requests SET admin_reply=NULL/i.test(call.sql || '') && /replied_at < strftime/i.test(call.sql || '')));
  assert.ok(env.calls.some(call => /DELETE FROM notification_events WHERE event_type IN/i.test(call.sql || '')));
  assert.equal(env.calls.some(call => /DELETE FROM orders/i.test(call.sql || '')), false);
});

test('customer message route rejects unsupported methods and creates a message through the API handler', async () => {
  const unsupported = await handleCustomerMessages(new Request('https://freshway.invalid/api/customer/messages', { method: 'DELETE' }), {}, CUSTOMER_ID);
  assert.equal(unsupported.status, 405);
  const env = fakeEnv();
  const posted = await handleCustomerMessages(new Request('https://freshway.invalid/api/customer/messages', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'Delivery question', message: 'Please confirm the delivery.' })
  }), env, CUSTOMER_ID);
  assert.equal(posted.status, 201);
  assert.equal(posted.data.ok, true);
});
