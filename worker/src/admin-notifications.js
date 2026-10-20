import { dispatchOrderAlert } from './order-alerts.js';

const text = value => String(value ?? '').trim();
const statusText = status => ({
  New: 'status is now New',
  Confirmed: 'is confirmed',
  Processing: 'is being prepared',
  Ready: 'is ready',
  'Out for Delivery': 'is out for delivery',
  Delivered: 'has been delivered',
  Cancelled: 'has been cancelled'
})[status] || `status changed to ${String(status || 'updated').toLowerCase()}`;
const paymentText = payment => ({
  'Not Collected': 'cash payment is still pending',
  Collected: 'cash payment has been collected',
  Refunded: 'payment has been refunded',
  Cancelled: 'payment has been cancelled'
})[payment] || `payment status changed to ${String(payment || 'updated').toLowerCase()}`;

export function buildOrderChangeAlerts(id, before, after, nonce = String(Date.now())) {
  if (!before || !after || Number(before.is_test_order || 0) === 1 || Number(after.is_test_order || 0) === 1) return [];
  const orderId = text(id);
  if (!orderId) return [];
  const alerts = [];
  const addPair = (eventType, title, customerBody, ownerTitle, ownerBody) => {
    for (const [audience, eventTitle, body, url] of [
      ['customer', title, customerBody, `/?openOrder=${encodeURIComponent(orderId)}#orders`],
      ['owner', ownerTitle, ownerBody, `/admin/?openOrder=${encodeURIComponent(orderId)}#orders`]
    ]) {
      alerts.push({
        audience, customerId: audience === 'customer' ? text(after.customer_id || before.customer_id) : '',
        orderId, eventType, title: audience === 'owner' ? `OWNER · ${eventTitle}` : eventTitle, body, url,
        eventKey: `order:${orderId}:${eventType}:${audience}:${nonce}`
      });
    }
  };

  const previousStatus = text(before.delivery_status);
  const nextStatus = text(after.delivery_status);
  if (nextStatus && previousStatus !== nextStatus) {
    addPair(
      'status_changed', 'FreshWay order update',
      `Your order ${orderId} ${statusText(nextStatus)}.`,
      'Order status updated',
      `${orderId}: ${previousStatus || 'Unknown'} → ${nextStatus}.`
    );
  }

  const previousPayment = text(before.payment_status);
  const nextPayment = text(after.payment_status);
  if (nextPayment && previousPayment !== nextPayment) {
    addPair(
      'payment_changed', 'FreshWay payment update',
      `For order ${orderId}, ${paymentText(nextPayment)}.`,
      'Order payment updated',
      `${orderId}: ${previousPayment || 'Unknown'} → ${nextPayment}.`
    );
  }

  const previousPlan = text(before.delivery_plan);
  const nextPlan = text(after.delivery_plan);
  if (nextPlan && previousPlan !== nextPlan) {
    addPair(
      'delivery_plan_changed', 'FreshWay delivery update',
      `The delivery plan for order ${orderId} is now ${nextPlan}.`,
      'Order delivery plan updated',
      `${orderId}: delivery plan changed from ${previousPlan || 'Unscheduled'} to ${nextPlan}.`
    );
  }
  return alerts;
}

/** Send alerts only after a successful Owner PATCH and only for persisted state changes. */
export async function notifyOrderChange(request, env, before) {
  try {
    if (request.method !== 'PATCH' || !new URL(request.url).pathname.startsWith('/api/admin/orders/') || !before) return;
    const id = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
    const after = await env.DB.prepare(
      'SELECT customer_id,delivery_status,payment_status,delivery_plan,is_test_order FROM orders WHERE id=?'
    ).bind(id).first();
    if (!after) return;
    const alerts = buildOrderChangeAlerts(id, before, after, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await Promise.all(alerts.map(alert => dispatchOrderAlert(env, alert).catch(error => {
      console.error('FreshWay order status alert failed:', error?.message || error);
      return { status: 'failed' };
    })));
  } catch (error) {
    // Order writes must not fail because a push provider or alert log is unavailable.
    console.error('FreshWay Owner order alert processing failed:', error?.message || error);
  }
}
