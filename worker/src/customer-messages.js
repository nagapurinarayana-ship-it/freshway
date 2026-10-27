import { dispatchOrderAlert } from './order-alerts.js';

const MESSAGE_MAX = 2000;
const SUBJECT_MAX = 120;
const REPLY_MAX = 2000;
const CUSTOMER_MAX = 50;
const GLOBAL_MAX = 10000;
const DAILY_SUBMISSION_MAX = 5;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const timestamp = () => new Date().toISOString();
const asObject = value => value && typeof value === 'object' ? value : {};
const uuid = () => crypto.randomUUID();
const validMessageId = value => /^[a-f0-9-]{36}$/i.test(String(value || ''));
const validOrderRequestId = value => /^request-[a-f0-9-]{36}$/i.test(String(value || ''));

function problem(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function cleanupExpiredCustomerMessages(env) {
  const messages = await env.DB.prepare(
    "DELETE FROM customer_messages WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  ).run();
  // Order requests are operational records tied to order history, so retain the
  // request row but purge the free-text reply after 90 days.
  const orderReplies = await env.DB.prepare(
    "UPDATE order_action_requests SET admin_reply=NULL,replied_at=NULL,reply_seen_at=NULL WHERE request_type='issue' AND admin_reply IS NOT NULL AND replied_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')"
  ).run();
  let notifications = 0;
  try {
    const result = await env.DB.prepare(
      "DELETE FROM notification_events WHERE event_type IN ('customer_message_reply','customer_message_new') AND created_at < datetime('now','-90 days')"
    ).run();
    notifications = Number(result?.meta?.changes || 0);
  } catch (_) {
    // Notifications are secondary to the durable message/reply record.
  }
  return {
    messagesDeleted: Number(messages?.meta?.changes || 0),
    oldOrderRepliesCleared: Number(orderReplies?.meta?.changes || 0),
    notificationsDeleted: notifications
  };
}

async function removeMessage(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM customer_messages WHERE id=?').bind(id),
    env.DB.prepare("DELETE FROM notification_events WHERE event_type IN ('customer_message_reply','customer_message_new') AND event_key LIKE ?").bind('customer-message:' + id + ':%')
  ]);
}

async function ensureRoom(env, customerId) {
  const own = await env.DB.prepare('SELECT COUNT(*) AS total FROM customer_messages WHERE customer_id=?').bind(customerId).first();
  if (Number(own?.total || 0) >= CUSTOMER_MAX) {
    const oldest = await env.DB.prepare("SELECT id FROM customer_messages WHERE customer_id=? AND status='replied' ORDER BY updated_at ASC LIMIT 1").bind(customerId).first();
    if (oldest?.id) await removeMessage(env, oldest.id);
    else problem('You have too many open messages. Please wait for FreshWay to reply before sending another.', 429);
  }
  const all = await env.DB.prepare('SELECT COUNT(*) AS total FROM customer_messages').first();
  if (Number(all?.total || 0) >= GLOBAL_MAX) {
    const rows = await env.DB.prepare("SELECT id FROM customer_messages WHERE status='replied' ORDER BY updated_at ASC LIMIT 100").all();
    const ids = (rows.results || []).map(row => row.id).filter(Boolean);
    if (ids.length) await env.DB.batch(ids.flatMap(id => [
      env.DB.prepare('DELETE FROM customer_messages WHERE id=?').bind(id),
      env.DB.prepare("DELETE FROM notification_events WHERE event_type IN ('customer_message_reply','customer_message_new') AND event_key LIKE ?").bind('customer-message:' + id + ':%')
    ]));
    const after = await env.DB.prepare('SELECT COUNT(*) AS total FROM customer_messages').first();
    if (Number(after?.total || 0) >= GLOBAL_MAX) problem('FreshWay support is busy. Please try again later.', 503);
  }
}

export async function createCustomerMessage(env, customerId, payloadValue) {
  await cleanupExpiredCustomerMessages(env);
  const payload = asObject(payloadValue);
  const subjectRaw = String(payload.subject ?? '').trim();
  const messageRaw = String(payload.message ?? '').trim();
  if (subjectRaw.length < 3) problem('Add a short subject (at least 3 characters).');
  if (subjectRaw.length > SUBJECT_MAX) problem('Subject must be 120 characters or fewer.');
  if (messageRaw.length < 5) problem('Please write a message with at least 5 characters.');
  if (messageRaw.length > MESSAGE_MAX) problem('Message must be 2,000 characters or fewer.');
  const subject = clean(subjectRaw, SUBJECT_MAX);
  const message = clean(messageRaw, MESSAGE_MAX);
  const customer = await env.DB.prepare('SELECT id,name,phone FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
  if (!customer) problem('Customer authentication required.', 401);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM customer_messages WHERE customer_id=? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')"
  ).bind(customerId).first();
  if (Number(recent?.total || 0) >= DAILY_SUBMISSION_MAX) problem('You have reached today’s message limit. Please wait for FreshWay to reply.', 429);
  await ensureRoom(env, customerId);
  const id = uuid();
  const name = clean(customer.name, 120) || 'Customer';
  const phone = String(customer.phone || '').replace(/\D/g, '');
  await env.DB.prepare(`INSERT INTO customer_messages
    (id,customer_id,customer_name,customer_phone_last4,subject,message,status,created_at,updated_at,expires_at)
    VALUES (?,?,?,?,?,?,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+90 days'))`)
    .bind(id, customerId, name, phone.slice(-4), subject, message).run();
  // Notify the Owner as a best-effort side effect. A push failure must not make a
  // saved customer message look unsent or invite duplicate submissions.
  try {
    await dispatchOrderAlert(env, {
      audience: 'owner', customerId: null, orderId: null,
      eventType: 'customer_message_new', eventKey: `customer-message:${id}:received:owner`,
      title: 'OWNER · New customer message',
      body: 'Open Owner Admin to read and reply.', url: '/admin/#messages'
    });
  } catch (error) { console.error('FreshWay new customer message alert failed:', error?.message || error); }
  return { ok: true, id, message: 'Message sent to FreshWay. You can view the reply in Profile → Messages.' };
}

export async function listCustomerMessages(env, customerId) {
  await cleanupExpiredCustomerMessages(env);
  const [general, orderRequests] = await Promise.all([
    env.DB.prepare(`SELECT id,subject,message,status,admin_reply,created_at,updated_at,replied_at,reply_seen_at,
      'message' AS source,NULL AS order_id
      FROM customer_messages WHERE customer_id=? ORDER BY created_at DESC LIMIT 50`).bind(customerId).all(),
    env.DB.prepare(`SELECT r.id,('Order help · ' || r.order_id) AS subject,r.reason AS message,
      CASE WHEN r.admin_reply IS NULL OR trim(r.admin_reply)='' THEN 'pending' ELSE 'replied' END AS status,
      r.admin_reply,r.created_at,r.updated_at,r.replied_at,r.reply_seen_at,
      'order_request' AS source,r.order_id
      FROM order_action_requests r
      WHERE r.customer_id=? AND r.request_type='issue'
        AND r.created_at >= datetime('now','-90 days')
        AND (r.status IN ('pending','approved') OR r.admin_reply IS NOT NULL)
      ORDER BY r.created_at DESC LIMIT 50`).bind(customerId).all()
  ]);
  return [...(general.results || []), ...(orderRequests.results || [])]
    .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,100);
}

export async function unreadCustomerMessageCount(env, customerId) {
  const [general, requests] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM customer_messages WHERE customer_id=? AND status='replied' AND reply_seen_at IS NULL").bind(customerId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM order_action_requests WHERE customer_id=? AND request_type='issue' AND admin_reply IS NOT NULL AND reply_seen_at IS NULL AND created_at >= datetime('now','-90 days')").bind(customerId).first()
  ]);
  return Number(general?.total || 0) + Number(requests?.total || 0);
}

export async function markCustomerMessagesRead(env, customerId) {
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE customer_messages SET reply_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE customer_id=? AND status='replied' AND reply_seen_at IS NULL").bind(customerId),
    env.DB.prepare("UPDATE order_action_requests SET reply_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE customer_id=? AND request_type='issue' AND admin_reply IS NOT NULL AND reply_seen_at IS NULL AND created_at >= datetime('now','-90 days')").bind(customerId)
  ]);
  return { ok: true, markedRead: (results || []).reduce((sum,result)=>sum+Number(result?.meta?.changes||0),0) };
}

export async function listAdminCustomerMessages(env, statusValue = 'pending') {
  const status = ['pending','replied','all'].includes(statusValue) ? statusValue : 'pending';
  const limit = status === 'all' ? 200 : 100;
  const generalSql = `SELECT id,customer_name,customer_phone_last4,subject,message,status,admin_reply,created_at,updated_at,replied_at,
      'message' AS source,NULL AS order_id
      FROM customer_messages ${status === 'all' ? '' : 'WHERE status=?'}
      ORDER BY created_at DESC LIMIT ${limit}`;
  const orderStatusWhere = status === 'pending'
    ? "AND (r.admin_reply IS NULL OR trim(r.admin_reply)='') AND r.status IN ('pending','approved')"
    : status === 'replied'
      ? "AND r.admin_reply IS NOT NULL AND trim(r.admin_reply)<>''"
      : "AND (r.status IN ('pending','approved') OR r.admin_reply IS NOT NULL)";
  const orderSql = `SELECT r.id, c.name AS customer_name, substr(c.phone,-4) AS customer_phone_last4,
      ('Order help · ' || r.order_id) AS subject,r.reason AS message,
      CASE WHEN r.admin_reply IS NULL OR trim(r.admin_reply)='' THEN 'pending' ELSE 'replied' END AS status,
      r.admin_reply,r.created_at,r.updated_at,r.replied_at,'order_request' AS source,r.order_id
      FROM order_action_requests r LEFT JOIN customers c ON c.id=r.customer_id
      WHERE r.request_type='issue' AND r.created_at >= datetime('now','-90 days') ${orderStatusWhere}
      ORDER BY r.created_at DESC LIMIT ${limit}`;
  const [general, orderRequests, generalCounts, orderCounts] = await Promise.all([
    (status === 'all' ? env.DB.prepare(generalSql) : env.DB.prepare(generalSql).bind(status)).all(),
    env.DB.prepare(orderSql).all(),
    env.DB.prepare('SELECT status,COUNT(*) AS total FROM customer_messages GROUP BY status').all(),
    env.DB.prepare(`SELECT CASE WHEN admin_reply IS NULL OR trim(admin_reply)='' THEN 'pending' ELSE 'replied' END AS status,COUNT(*) AS total
      FROM order_action_requests WHERE request_type='issue' AND created_at >= datetime('now','-90 days')
      AND (status IN ('pending','approved') OR admin_reply IS NOT NULL) GROUP BY status`).all()
  ]);
  const allMessages = [...(general.results || []), ...(orderRequests.results || [])];
  const summary = { pending: 0, replied: 0 };
  for (const row of [...(generalCounts.results || []), ...(orderCounts.results || [])]) {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) summary[row.status] += Number(row.total || 0);
  }
  const messages = allMessages.sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,100);
  return { messages, summary, status };
}

async function sendReplyNotification(env, customerId, messageId, body, kind = 'message') {
  try {
    return await dispatchOrderAlert(env, {
      audience: 'customer',
      customerId,
      orderId: null,
      eventType: 'customer_message_reply',
      eventKey: (kind==='order_request'?'order-request:':'customer-message:')+messageId+':reply:'+Date.now()+':'+uuid(),
      title: 'FreshWay replied to your message',
      body: 'Open FreshWay to read your reply.',
      url: '/?openMessage=' + encodeURIComponent(messageId) + '#messages'
    });
  } catch (error) {
    console.error('FreshWay message reply notification failed:', error?.message || error);
    return { status: 'failed', sent: 0, failed: 1 };
  }
}

export async function replyToCustomerMessage(env, id, payloadValue) {
  const isOrderRequest = validOrderRequestId(id);
  if (!isOrderRequest && !validMessageId(id)) problem('Invalid customer message id.');
  const payload = asObject(payloadValue);
  const replyRaw = String(payload.reply ?? '').trim();
  if (replyRaw.length < 2) problem('Reply must contain at least 2 characters.');
  if (replyRaw.length > REPLY_MAX) problem('Reply must be 2,000 characters or fewer.');
  const reply = clean(replyRaw, REPLY_MAX);
  if (isOrderRequest) {
    const existing = await env.DB.prepare("SELECT id,customer_id,admin_reply FROM order_action_requests WHERE id=? AND request_type='issue' LIMIT 1").bind(id).first();
    if (!existing) problem('CUSTOMER_MESSAGE_NOT_FOUND', 404);
    if (String(existing.admin_reply || '') === reply) return { ok: true, unchanged: true, notification: 'already_sent' };
    await env.DB.prepare("UPDATE order_action_requests SET admin_reply=?,replied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),reply_seen_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND request_type='issue'")
      .bind(reply, id).run();
    const notification = await sendReplyNotification(env, existing.customer_id, id, reply, 'order_request');
    return { ok: true, notification };
  }
  const existing = await env.DB.prepare('SELECT id,customer_id,status,admin_reply FROM customer_messages WHERE id=? LIMIT 1').bind(id).first();
  if (!existing) problem('CUSTOMER_MESSAGE_NOT_FOUND', 404);
  if (existing.status === 'replied' && String(existing.admin_reply || '') === reply) {
    return { ok: true, unchanged: true, notification: 'already_sent' };
  }
  await env.DB.prepare(`UPDATE customer_messages SET status='replied',admin_reply=?,replied_at=?,reply_seen_at=NULL,updated_at=?,expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+90 days') WHERE id=?`)
    .bind(reply, timestamp(), timestamp(), id).run();
  const notification = await sendReplyNotification(env, existing.customer_id, id, reply, 'message');
  return { ok: true, notification };
}

export async function deleteCustomerMessage(env, id) {
  if (!validMessageId(id)) problem('Invalid customer message id.');
  const existing = await env.DB.prepare('SELECT id FROM customer_messages WHERE id=? LIMIT 1').bind(id).first();
  if (!existing) problem('CUSTOMER_MESSAGE_NOT_FOUND', 404);
  await removeMessage(env, id);
  return { ok: true };
}

export async function handleCustomerMessages(request, env, customerId) {
  const path = new URL(request.url).pathname;
  try {
    if (path === '/api/customer/messages' && request.method === 'POST') {
      let payload={};try{payload=await request.json();}catch(_){problem('Send a valid message.');}
      return { status: 201, data: await createCustomerMessage(env, customerId, payload) };
    }
    if (path === '/api/customer/messages' && request.method === 'GET') {
      return { status: 200, data: { messages: await listCustomerMessages(env, customerId) } };
    }
    if (path === '/api/customer/messages/unread-count' && request.method === 'GET') {
      return { status: 200, data: { unreadCount: await unreadCustomerMessageCount(env, customerId) } };
    }
    if (path === '/api/customer/messages/read' && request.method === 'PATCH') {
      return { status: 200, data: await markCustomerMessagesRead(env, customerId) };
    }
    return { status: 405, data: { error: 'Method not allowed.' } };
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error('FreshWay customer message operation failed:', error?.message || error);
    return { status, data: { error: status === 500 ? 'Could not process your message. Please try again.' : String(error.message || 'Request could not be completed.') } };
  }
}

export async function handleAdminCustomerMessages(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === '/api/admin/customer-messages' && request.method === 'GET') {
      await cleanupExpiredCustomerMessages(env);
      return { status: 200, data: await listAdminCustomerMessages(env, url.searchParams.get('status') || 'pending') };
    }
    const orderReplyMatch = path.match(/^\/api\/admin\/customer-messages\/order-requests\/([^/]+)\/reply$/i);
    if (orderReplyMatch && request.method === 'PATCH') {
      let payload={};try{payload=await request.json();}catch(_){problem('Send a valid reply.');}
      return { status: 200, data: await replyToCustomerMessage(env, decodeURIComponent(orderReplyMatch[1]), payload) };
    }
    const replyMatch = path.match(/^\/api\/admin\/customer-messages\/([a-f0-9-]{36})\/reply$/i);
    if (replyMatch && request.method === 'PATCH') {
      let payload={};try{payload=await request.json();}catch(_){problem('Send a valid reply.');}
      return { status: 200, data: await replyToCustomerMessage(env, replyMatch[1], payload) };
    }
    const deleteMatch = path.match(/^\/api\/admin\/customer-messages\/([a-f0-9-]{36})$/i);
    if (deleteMatch && request.method === 'DELETE') {
      return { status: 200, data: await deleteCustomerMessage(env, deleteMatch[1]) };
    }
    return { status: 405, data: { error: 'Method not allowed.' } };
  } catch (error) {
    const status = Number(error?.status || (error?.message === 'CUSTOMER_MESSAGE_NOT_FOUND' ? 404 : 500));
    if (status >= 500) console.error('FreshWay Owner message operation failed:', error?.message || error);
    return { status, data: { error: status === 500 ? 'Could not process this message. Refresh and try again.' : error.message === 'CUSTOMER_MESSAGE_NOT_FOUND' ? 'Customer message not found.' : String(error.message || 'Request could not be completed.') } };
  }
}
