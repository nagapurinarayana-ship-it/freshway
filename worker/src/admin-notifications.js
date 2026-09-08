import webpush from 'web-push';

/**
 * Sends customer notifications for owner-side order changes.
 * Kept outside admin-auth so authentication changes cannot alter notification logic.
 */
export async function notifyOrderChange(request, env) {
  try {
    if (request.method !== 'PATCH' || !new URL(request.url).pathname.startsWith('/api/admin/orders/')) return;

    const payload = await request.clone().json();
    const id = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
    const row = await env.DB.prepare(
      'SELECT customer_id,delivery_status,payment_status,delivery_plan FROM orders WHERE id=?'
    ).bind(id).first();
    if (!row) return;

    const status = String(payload.status || '').trim();
    const payment = String(payload.payment || '').trim();
    const plan = String(payload.deliveryPlan || '').trim();
    let title = '';
    let message = '';

    if (status) {
      if (status === 'Confirmed') message = `Order ${id} has been confirmed.`;
      else if (status === 'Processing') message = `Order ${id} is now being prepared.`;
      else if (status === 'Ready') message = `Order ${id} is ready for delivery.`;
      else if (status === 'Out for Delivery') message = `Order ${id} is out for delivery.`;
      else if (status === 'Delivered') message = `Order ${id} has been delivered.`;
      else if (status === 'Cancelled') message = `Order ${id} has been cancelled.`;
      else if (status === 'New') message = `Order ${id} is now new.`;
      if (message) title = 'FreshWay order update';
    } else if (payment === 'Collected') {
      title = 'FreshWay payment update';
      message = `Payment for order ${id} has been collected.`;
    } else if (payment === 'Refunded') {
      title = 'FreshWay payment update';
      message = `Payment for order ${id} has been refunded.`;
    } else if (payment === 'Cancelled') {
      title = 'FreshWay payment update';
      message = `Payment for order ${id} has been cancelled.`;
    } else if (payment === 'Not Collected') {
      title = 'FreshWay payment update';
      message = `Payment for order ${id} is not collected.`;
    } else if (plan) {
      title = 'FreshWay delivery update';
      message = `Delivery for order ${id} is planned for ${plan}.`;
    }

    if (!message || !row.customer_id || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;

    const subs = (await env.DB.prepare(
      'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE customer_id=?'
    ).bind(row.customer_id).all()).results || [];
    if (!subs.length) return;

    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const dead = [];
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body: message, url: `/orders/${id}`, tag: `freshway-order-${id}` })
        );
      } catch (error) {
        if ([404, 410].includes(error?.statusCode)) dead.push(sub.endpoint);
      }
    }));

    if (dead.length) {
      await env.DB.batch(dead.map(endpoint =>
        env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)
      ));
    }
  } catch (_) {
    // Notifications are best-effort and must never fail the order update response.
  }
}
