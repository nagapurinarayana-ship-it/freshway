import webpush from 'web-push';

const pushConfigured = env => Boolean(
  String(env.VAPID_PUBLIC_KEY || '').trim() &&
  String(env.VAPID_PRIVATE_KEY || '').trim() &&
  String(env.VAPID_SUBJECT || '').trim()
);

const cleanText = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const safePath = value => {
  const path = String(value || '/');
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path.slice(0, 500) : '/';
};

export function buildOrderPlacedAlerts(order) {
  const id = cleanText(order?.id, 100);
  const total = Number(order?.total || 0);
  const itemCount = Array.isArray(order?.items) ? order.items.reduce((n, item) => n + Math.max(0, Number(item?.qty) || 0), 0) : 0;
  const amount = `₹${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const customerName = cleanText(order?.customerName, 80) || 'Customer';
  return [
    {
      audience: 'customer', customerId: cleanText(order?.customerId, 100), orderId: id,
      eventType: 'order_placed', eventKey: `order:${id}:placed:customer`,
      title: 'Order received · FreshWay',
      body: `We received order ${id} for ${amount}. We’ll notify you when it’s confirmed.`,
      url: `/?openOrder=${encodeURIComponent(id)}#orders`
    },
    {
      audience: 'owner', customerId: '', orderId: id,
      eventType: 'new_order', eventKey: `order:${id}:placed:owner`,
      title: 'OWNER · New FreshWay order',
      body: `${customerName} · ${id} · ${amount} · ${itemCount} item${itemCount === 1 ? '' : 's'} · Cash pending`,
      url: `/admin/?openOrder=${encodeURIComponent(id)}#orders`
    }
  ];
}

async function updateEvent(env, eventId, values) {
  await env.DB.prepare(`UPDATE notification_events
    SET status=?,recipient_count=?,success_count=?,failure_count=?,last_error=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(
      values.status, values.recipientCount || 0, values.successCount || 0,
      values.failureCount || 0, values.lastError || null, eventId
    ).run();
}

/**
 * Store every transactional alert before attempting delivery. The unique event key
 * makes repeated delivery attempts harmless and keeps push failures from failing an order.
 */
export async function dispatchOrderAlert(env, alert) {
  const audience = alert?.audience === 'owner' ? 'owner' : 'customer';
  const customerId = audience === 'customer' ? cleanText(alert?.customerId, 100) : null;
  const orderId = cleanText(alert?.orderId, 100) || null;
  const eventType = cleanText(alert?.eventType, 60) || 'order_update';
  const eventKey = cleanText(alert?.eventKey, 240);
  const title = cleanText(alert?.title, 80) || 'FreshWay order update';
  const body = cleanText(alert?.body, 300) || 'There is an update about your FreshWay order.';
  const url = safePath(alert?.url);
  if (!eventKey) return { status: 'invalid_event', sent: 0, failed: 0 };

  let eventId;
  try {
    const inserted = await env.DB.prepare(`INSERT INTO notification_events
      (event_key,audience,customer_id,order_id,event_type,title,body,target_url,status)
      VALUES (?,?,?,?,?,?,?,?, 'sending') ON CONFLICT(event_key) DO NOTHING`)
      .bind(eventKey, audience, customerId, orderId, eventType, title, body, url).run();
    if (inserted?.meta?.changes === 0) return { status: 'duplicate', sent: 0, failed: 0 };
    const event = await env.DB.prepare('SELECT id FROM notification_events WHERE event_key=? LIMIT 1').bind(eventKey).first();
    eventId = event?.id;
    if (!eventId) return { status: 'logged_without_id', sent: 0, failed: 0 };
  } catch (error) {
    // Alert storage is best-effort at this boundary; never roll back a placed order or status change.
    console.error('FreshWay order alert could not be recorded:', error?.message || error);
    return { status: 'log_failed', sent: 0, failed: 0 };
  }

  if (!pushConfigured(env)) {
    try { await updateEvent(env, eventId, { status: 'not_configured', lastError: 'PUSH_NOT_CONFIGURED' }); } catch (_) {}
    return { status: 'not_configured', sent: 0, failed: 0 };
  }

  let subscriptions = [];
  try {
    const result = audience === 'owner'
      ? await env.DB.prepare('SELECT endpoint,p256dh,auth FROM owner_push_subscriptions WHERE owner_key=?').bind('default').all()
      : await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE customer_id=?').bind(customerId).all();
    subscriptions = result?.results || [];
  } catch (error) {
    try { await updateEvent(env, eventId, { status: 'failed', lastError: 'SUBSCRIPTION_LOOKUP_FAILED' }); } catch (_) {}
    console.error('FreshWay order alert subscription lookup failed:', error?.message || error);
    return { status: 'failed', sent: 0, failed: 0 };
  }

  if (!subscriptions.length) {
    try { await updateEvent(env, eventId, { status: 'no_subscriptions', lastError: 'NO_ENABLED_DEVICE' }); } catch (_) {}
    return { status: 'no_subscriptions', sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const dead = [];
  const payload = JSON.stringify({
    title, body, url,
    tag: eventKey,
    icon: audience === 'owner' ? '/admin/icons/icon-192.svg' : '/icon.svg',
    data: { audience, orderId, eventType }
  });
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    await Promise.all(subscriptions.map(async subscription => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload
        );
        sent++;
      } catch (error) {
        failed++;
        const statusCode = Number(error?.statusCode || 0);
        if ([404, 410].includes(statusCode)) dead.push(subscription.endpoint);
      }
    }));
  } catch (error) {
    failed = subscriptions.length;
    console.error('FreshWay order alert send failed:', error?.message || error);
  }

  if (dead.length) {
    try {
      const table = audience === 'owner' ? 'owner_push_subscriptions' : 'push_subscriptions';
      await env.DB.batch(dead.map(endpoint => env.DB.prepare(`DELETE FROM ${table} WHERE endpoint=?`).bind(endpoint)));
    } catch (_) {}
  }

  const status = sent > 0 && failed === 0 ? 'sent' : sent > 0 ? 'partial' : 'failed';
  try {
    await updateEvent(env, eventId, {
      status, recipientCount: subscriptions.length, successCount: sent, failureCount: failed,
      lastError: failed ? 'ONE_OR_MORE_PUSH_DELIVERIES_FAILED' : null
    });
  } catch (error) {
    console.error('FreshWay order alert result could not be saved:', error?.message || error);
  }
  return { status, sent, failed };
}

export async function saveOwnerSubscription(env, payload) {
  const subscription = payload?.subscription;
  const endpoint = cleanText(subscription?.endpoint, 2048);
  const p256dh = cleanText(subscription?.keys?.p256dh, 500);
  const auth = cleanText(subscription?.keys?.auth, 500);
  let parsed;
  try { parsed = new URL(endpoint); } catch (_) { throw new Error('Invalid push endpoint.'); }
  if (parsed.protocol !== 'https:') throw new Error('Invalid push endpoint.');
  if (!p256dh || !auth) throw new Error('Invalid push subscription keys.');
  await env.DB.prepare(`INSERT INTO owner_push_subscriptions
    (owner_key,endpoint,p256dh,auth,expiration_time,updated_at)
    VALUES ('default',?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET owner_key='default',p256dh=excluded.p256dh,auth=excluded.auth,
      expiration_time=excluded.expiration_time,updated_at=CURRENT_TIMESTAMP`)
    .bind(endpoint, p256dh, auth, Number.isFinite(Number(subscription.expirationTime)) ? Number(subscription.expirationTime) : null).run();
  return { ok: true };
}

export async function deleteOwnerSubscription(env, payload) {
  const endpoint = cleanText(payload?.endpoint, 2048);
  if (!endpoint) throw new Error('Push endpoint is required.');
  await env.DB.prepare('DELETE FROM owner_push_subscriptions WHERE owner_key=? AND endpoint=?').bind('default', endpoint).run();
  return { ok: true };
}

export async function listOwnerOrderAlerts(env, limit = 30, beforeId = null) {
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 30));
  const rawCursor = String(beforeId ?? '').trim();
  let cursor = null;
  if (rawCursor) {
    if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor)) || Number(rawCursor) < 1) {
      throw new Error('Invalid Owner alert cursor.');
    }
    cursor = Number(rawCursor);
  }

  const query = cursor
    ? `SELECT id,order_id,event_type,title,body,status,recipient_count,success_count,failure_count,created_at
       FROM notification_events WHERE audience='owner' AND id < ? ORDER BY id DESC LIMIT ?`
    : `SELECT id,order_id,event_type,title,body,status,recipient_count,success_count,failure_count,created_at
       FROM notification_events WHERE audience='owner' ORDER BY id DESC LIMIT ?`;
  const statement = env.DB.prepare(query);
  const result = cursor ? await statement.bind(cursor, safeLimit).all() : await statement.bind(safeLimit).all();
  return result?.results || [];
}

export async function deleteOwnerOrderAlert(env, id) {
  const rawId = String(id ?? '').trim();
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) < 1) {
    throw new Error('Invalid Owner alert id.');
  }
  const result = await env.DB.prepare(
    "DELETE FROM notification_events WHERE id=? AND audience='owner'"
  ).bind(Number(rawId)).run();
  return { ok: true, deleted: Number(result?.meta?.changes || 0) };
}

export async function deleteAllOwnerOrderAlerts(env) {
  const result = await env.DB.prepare(
    "DELETE FROM notification_events WHERE audience='owner'"
  ).run();
  return { ok: true, deleted: Number(result?.meta?.changes || 0) };
}
