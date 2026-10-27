import { dispatchOrderAlert } from './order-alerts.js';

const MESSAGE_MAX = 2000;
const SUBJECT_MAX = 120;
const REPLY_MAX = 2000;
const CUSTOMER_MAX = 50;
const GLOBAL_MAX = 10000;
const DAILY_SUBMISSION_MAX = 5;
const RETENTION_DAYS = 90;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const timestamp = () => new Date().toISOString();
const jsonSafe = value => value && typeof value === 'object' ? value : {};
const uuid = () => crypto.randomUUID();

function problem(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function cleanupExpiredCustomerMessages(env) {
  const messages = await env.DB.prepare(
    "DELETE FROM customer_messages WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  ).run();
  // Reply notifications are retained only for the same 90-day support window.
  let notifications = 0;
  try {
    const result = await env.DB.prepare(
      "DELETE FROM notification_events WHERE event_type='customer_message_reply' AND created_at < datetime('now','-90 days')"
    ).run();
    notifications = Number(result?.meta?.changes || 0);
  } catch (_) {
    // Customer messages are the source of truth; notification cleanup must not
    // block sign-in, checkout, or the hourly scheduled task.
  }
  return { messagesDeleted: Number(messages?.meta?.changes || 0), notificationsDeleted: notifications };
}

async function removeMessage(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM customer_messages WHERE id=?').bind(id),
    env.DB.prepare("DELETE FROM notification_events WHERE event_type='customer_message_reply' AND event_key LIKE ?").bind('customer-message:' + id + ':reply:%')
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
      env.DB.prepare("DELETE FROM notification_events WHERE event_type='customer_message_reply' AND event_key LIKE ?").bind('customer-message:' + id + ':reply:%')
    ]));
    const after = await env.DB.prepare('SELECT COUNT(*) AS total FROM customer_messages').first();
    if (Number(after?.total || 0) >= GLOBAL_MAX) problem('FreshWay support is busy. Please try again later.', 503);
  }
}

export async function createCustomerMessage(env, customerId, payloadValue) {
  await cleanupExpiredCustomerMessages(env);
  const payload = jsonSafe(payloadValue);
  const subject = clean(payload.subject, SUBJECT_MAX);
  const message = clean(payload.message, MESSAGE_MAX);
  if (subject.length < 3) problem('Add a short subject (at least 3 characters).');
  if (message.length < 5) problem('Please write a message with at least 5 characters.');
  if (String(payload.message ?? '').trim().length > MESSAGE_MAX) problem('Message must be 2,000 characters or fewer.');
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
  return { ok: true, id, message: 'Message sent to FreshWay. You can view the reply in Profile → Messages.' };
}

export async function listCustomerMessages(env, customerId) {
  await cleanupExpiredCustomerMessages(env);
  const result = await env.DB.prepare(`SELECT id,subject,message,status,admin_reply,created_at,updated_at,replied_at,reply_seen_at
    FROM customer_messages WHERE customer_id=? ORDER BY created_at DESC LIMIT 50`).bind(customerId).all();
  return result.results || [];
}

export async function unreadCustomerMessageCount(env, customerId) {
  const result = await env.DB.prepare("SELECT COUNT(*) AS total FROM customer_messages WHERE customer_id=? AND status='replied' AND reply_seen_at IS NULL").bind(customerId).first();
  return Number(result?.total || 0);
}

export async function markCustomerMessagesRead(env, customerId) {
  const result = await env.DB.prepare("UPDATE customer_messages SET reply_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE customer_id=? AND status='replied' AND reply_seen_at IS NULL").bind(customerId).run();
  return { ok: true, markedRead: Number(result?.meta?.changes || 0) };
}

export async function listAdminCustomerMessages(env, statusValue = 'pending') {
  const status = ['pending','replied','all'].includes(statusValue) ? statusValue : 'pending';
  const where = status === 'all' ? '' : ' WHERE status=?';
  const rows = await env.DB.prepare(`SELECT id,customer_id,customer_name,customer_phone_last4,subject,message,status,admin_reply,created_at,updated_at,replied_at
    FROM customer_messages${where} ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 100`)
    .bind(...(status === 'all' ? [] : [status])).all();
  const counts = await env.DB.prepare("SELECT status,COUNT(*) AS total FROM customer_messages GROUP BY status").all();
  const summary = { pending: 0, replied: 0 };
  for (const row of counts.results || []) if (Object.prototype.hasOwnProperty.call(summary, row.status)) summary[row.status] = Number(row.total || 0);
  return { messages: rows.results || [], summary, status };
}

export async function replyToCustomerMessage(env, id, payloadValue) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) problem('Invalid customer message id.');
  const payload = jsonSafe(payloadValue);
  const reply = clean(payload.reply, REPLY_MAX);
  if (reply.length < 2) problem('Reply must contain at least 2 characters.');
  if (String(payload.reply ?? '').trim().length > REPLY_MAX) problem('Reply must be 2,000 characters or fewer.');
  const existing = await env.DB.prepare('SELECT id,customer_id,status,admin_reply FROM customer_messages WHERE id=? LIMIT 1').bind(id).first();
  if (!existing) problem('CUSTOMER_MESSAGE_NOT_FOUND', 404);
  if (existing.status === 'replied' && String(existing.admin_reply || '') === reply) {
    return { ok: true, unchanged: true, notification: 'already_sent' };
  }
  const savedAt = timestamp();
  await env.DB.prepare(`UPDATE customer_messages SET status='replied',admin_reply=?,replied_at=?,reply_seen_at=NULL,updated_at=?,expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+90 days') WHERE id=?`)
    .bind(reply, savedAt, savedAt, id).run();
  let notification = { status: 'not_attempted', sent: 0, failed: 0 };
  try {
    notification = await dispatchOrderAlert(env, {
      audience: 'customer',
      customerId: existing.customer_id,
      orderId: null,
      eventType: 'customer_message_reply',
      eventKey: `customer-message:${id}:reply:${savedAt}:${uuid()}`,
      title: 'FreshWay replied to your message',
      body: reply.length > 220 ? reply.slice(0, 217) + '…' : reply,
      url: '/?openMessage=' + encodeURIComponent(id) + '#messages'
    });
  } catch (error) {
    console.error('FreshWay message reply notification failed:', error?.message || error);
    notification = { status: 'failed', sent: 0, failed: 1 };
  }
  return { ok: true, notification };
}

export async function deleteCustomerMessage(env, id) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) problem('Invalid customer message id.');
  const existing = await env.DB.prepare('SELECT id FROM customer_messages WHERE id=? LIMIT 1').bind(id).first();
  if (!existing) problem('CUSTOMER_MESSAGE_NOT_FOUND', 404);
  await removeMessage(env, id);
  return { ok: true };
}

export async function handleCustomerMessages(request, env, customerId) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === '/api/customer/messages' && request.method === 'POST') {
      return { status: 201, data: await createCustomerMessage(env, customerId, await request.json()) };
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
    const replyMatch = path.match(/^\/api\/admin\/customer-messages\/([a-f0-9-]+)\/reply$/i);
    if (replyMatch && request.method === 'PATCH') {
      return { status: 200, data: await replyToCustomerMessage(env, replyMatch[1], await request.json()) };
    }
    const deleteMatch = path.match(/^\/api\/admin\/customer-messages\/([a-f0-9-]+)$/i);
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
