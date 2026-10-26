import { updateOrder } from './admin-orders.js';
import { buildOrderChangeAlerts } from './admin-notifications.js';
import { dispatchOrderAlert } from './order-alerts.js';

const enc = value => JSON.stringify(value ?? null);
const clean = value => String(value ?? '').trim();
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
});
const id = prefix => prefix + '-' + crypto.randomUUID();
const int = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseTimeMinutes(value) {
  const match = String(value ?? '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function formatTimeMinutes(value) {
  const minute = Number(value);
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) return '';
  return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
}
export function distanceKm(aLat, aLng, bLat, bLng) {
  const values = [aLat, aLng, bLat, bLng].map(Number);
  if (!values.every(Number.isFinite) || Math.abs(values[0]) > 90 || Math.abs(values[2]) > 90 ||
      Math.abs(values[1]) > 180 || Math.abs(values[3]) > 180) return null;
  const rad = deg => deg * Math.PI / 180;
  const dLat = rad(values[2] - values[0]), dLng = rad(values[3] - values[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(values[0])) * Math.cos(rad(values[2])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}
function dateValid(value) {
  if (!datePattern.test(String(value || ''))) return false;
  const parts = value.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return d.getUTCFullYear() === parts[0] && d.getUTCMonth() === parts[1] - 1 && d.getUTCDate() === parts[2];
}
function addDays(date, days) {
  const p = date.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function istNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const out = {};
  for (const part of parts) out[part.type] = part.value;
  return { date: out.year + '-' + out.month + '-' + out.day, minute: Number(out.hour) * 60 + Number(out.minute) };
}
function hasCoordinates(address = {}) {
  const lat = Number(address.latitude ?? address.lat), lng = Number(address.longitude ?? address.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
function addressCoordinates(address = {}) {
  return { latitude: Number(address.latitude ?? address.lat), longitude: Number(address.longitude ?? address.lng) };
}
function distanceFor(address, store, storeCount) {
  if (!hasCoordinates(address)) return storeCount === 1 ? null : Infinity;
  const point = addressCoordinates(address);
  const distance = distanceKm(point.latitude, point.longitude, store.latitude, store.longitude);
  return distance !== null && distance <= Number(store.service_radius_km) ? distance : Infinity;
}
function slotCanBeCustomerBooked(slot, settings, now = istNowParts()) {
  if (!dateValid(slot.delivery_date)) return false;
  if (!slot.is_active || !slot.store_active) return false;
  if (slot.delivery_date < now.date || slot.delivery_date > addDays(now.date, Number(settings.booking_horizon_days || 7))) return false;
  if (slot.delivery_date === now.date && Number(slot.start_minute) < now.minute + Number(settings.same_day_cutoff_minutes || 0)) return false;
  return true;
}
async function readSettings(env) {
  const row = await env.DB.prepare('SELECT enabled,booking_horizon_days,same_day_cutoff_minutes,timezone,updated_at FROM delivery_scheduling_settings WHERE id=1').first();
  return row || { enabled: 0, booking_horizon_days: 7, same_day_cutoff_minutes: 120, timezone: 'Asia/Kolkata' };
}
async function inventoryMap(env, excludeOrderId = '') {
  const sql = excludeOrderId
    ? 'SELECT i.store_id,i.product_id,i.stock_quantity,COALESCE(SUM(CASE WHEN r.status IN (\'reserved\',\'conflict\') THEN r.qty ELSE 0 END),0) reserved_qty ' +
      'FROM delivery_store_inventory i LEFT JOIN delivery_store_inventory_reservations r ON r.store_id=i.store_id AND r.product_id=i.product_id AND r.order_id<>? ' +
      'GROUP BY i.store_id,i.product_id'
    : 'SELECT i.store_id,i.product_id,i.stock_quantity,COALESCE(SUM(CASE WHEN r.status IN (\'reserved\',\'conflict\') THEN r.qty ELSE 0 END),0) reserved_qty ' +
      'FROM delivery_store_inventory i LEFT JOIN delivery_store_inventory_reservations r ON r.store_id=i.store_id AND r.product_id=i.product_id ' +
      'GROUP BY i.store_id,i.product_id';
  const query = env.DB.prepare(sql);
  const rows = (await (excludeOrderId ? query.bind(excludeOrderId) : query).all()).results || [];
  const map = new Map();
  for (const row of rows) map.set(row.store_id + '|' + row.product_id, {
    quantity: Number(row.stock_quantity || 0), reserved: Number(row.reserved_qty || 0)
  });
  return map;
}
async function ensureStoreInventoryRows(env) {
  // New stock-managed products may be created after stores already exist. Add missing
  // per-store rows at zero so they can be explicitly allocated without inventing stock.
  await env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) ' +
    'SELECT s.id,p.id,0 FROM delivery_stores s CROSS JOIN products p WHERE p.stock_managed=1'
  ).run();
}
function itemNeedsStock(item) {
  return Number(item.stockReservedQty ?? item.stock_reserved_qty ?? 0) > 0;
}
function inventoryFits(storeId, items, stock) {
  return items.filter(itemNeedsStock).every(item => {
    const row = stock.get(storeId + '|' + String(item.id ?? item.product_id));
    return !!row && row.quantity - row.reserved >= Number(item.qty || 0);
  });
}
async function slotRows(env, fromDate, toDate) {
  return (await env.DB.prepare(
    'SELECT s.id,s.store_id,s.delivery_date,s.start_minute,s.end_minute,s.capacity,s.is_active,' +
    'ds.name store_name,ds.latitude,ds.longitude,ds.service_radius_km,ds.is_active store_active,' +
    '(SELECT COUNT(*) FROM delivery_slot_reservations r WHERE r.slot_id=s.id AND r.status IN (\'reserved\',\'conflict\')) occupied ' +
    'FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id ' +
    'WHERE s.delivery_date>=? AND s.delivery_date<=? ORDER BY s.delivery_date,s.start_minute,ds.name'
  ).bind(fromDate, toDate).all()).results || [];
}
async function cleanItems(env, raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const quantities = new Map();
  for (const item of raw) {
    const productId = clean(item?.id || item?.productId || item?.product_id);
    const qty = int(item?.qty ?? item?.quantity, 0);
    if (!productId || qty < 1 || qty > 99) throw new Error('The basket contains an invalid product quantity. Refresh the cart and try again.');
    const combined = (quantities.get(productId) || 0) + qty;
    if (combined > 99) throw new Error('Maximum quantity for a product is 99.');
    quantities.set(productId, combined);
  }
  const ids = [...quantities.keys()];
  const placeholders = ids.map(() => '?').join(',');
  const rows = (await env.DB.prepare('SELECT id,stock_managed FROM products WHERE active=1 AND id IN (' + placeholders + ')').bind(...ids).all()).results || [];
  if (rows.length !== ids.length) throw new Error('One or more products are no longer available. Refresh your cart and try again.');
  return rows.map(product => {
    const qty = quantities.get(product.id);
    return { id: product.id, qty, stockReservedQty: Number(product.stock_managed) === 1 ? qty : 0 };
  });
}
async function resolveAvailableSlots(env, payload, requestedDate = '', excludeOrderId = '') {
  const settings = await readSettings(env);
  if (!Number(settings.enabled)) return { enabled: false, settings, slots: [] };
  const now = istNowParts();
  const dateFrom = requestedDate || now.date;
  if (!dateValid(dateFrom)) throw new Error('Invalid delivery date.');
  const dateTo = addDays(now.date, Number(settings.booking_horizon_days || 7));
  if (dateFrom < now.date || dateFrom > dateTo) throw new Error('Choose a date within the available delivery window.');
  const items = await cleanItems(env, payload.items);
  if (!items.length) return { enabled: true, settings, slots: [], message: 'Add products to your cart to check delivery availability.' };
  const activeStores = (await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count || 0;
  const stock = await inventoryMap(env, excludeOrderId);
  const rows = await slotRows(env, dateFrom, dateTo);
  const eligible = [];
  for (const slot of rows) {
    if (slot.delivery_date !== dateFrom || !slotCanBeCustomerBooked(slot, settings, now)) continue;
    const distance = distanceFor(payload.address || {}, slot, Number(activeStores));
    if (distance === Infinity) continue;
    if (Number(slot.occupied) >= Number(slot.capacity)) continue;
    if (!inventoryFits(slot.store_id, items, stock)) continue;
    eligible.push({ ...slot, distance_km: distance });
  }
  eligible.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0) || a.start_minute - b.start_minute || a.store_name.localeCompare(b.store_name));
  const windows = new Map();
  for (const slot of eligible) {
    const key = [slot.delivery_date, slot.start_minute, slot.end_minute].join('|');
    const existing = windows.get(key);
    if (!existing) windows.set(key, slot);
  }
  return {
    enabled: true,
    settings: { bookingHorizonDays: Number(settings.booking_horizon_days), sameDayCutoffMinutes: Number(settings.same_day_cutoff_minutes), timezone: 'Asia/Kolkata' },
    slots: [...windows.values()].map(slot => ({
      id: slot.id, date: slot.delivery_date, startMinute: Number(slot.start_minute), endMinute: Number(slot.end_minute),
      startTime: formatTimeMinutes(slot.start_minute), endTime: formatTimeMinutes(slot.end_minute),
      storeName: slot.store_name, distanceKm: slot.distance_km === null ? null : Math.round(Number(slot.distance_km) * 10) / 10,
      remainingCapacity: Math.max(0, Number(slot.capacity) - Number(slot.occupied))
    }))
  };
}
export async function prepareCheckoutDelivery(env, payload, items) {
  const settings = await readSettings(env);
  if (!Number(settings.enabled)) return null;
  const selectedId = clean(payload.deliverySlotId || payload.delivery_slot_id);
  if (!selectedId) throw new Error('Choose an available delivery date and time window before placing your order.');
  const selected = await env.DB.prepare(
    'SELECT s.id,s.store_id,s.delivery_date,s.start_minute,s.end_minute,s.capacity,s.is_active,ds.name store_name,' +
    'ds.latitude,ds.longitude,ds.service_radius_km,ds.is_active store_active ' +
    'FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.id=? LIMIT 1'
  ).bind(selectedId).first();
  if (!selected || !dateValid(selected.delivery_date)) throw new Error('That delivery window is no longer available. Refresh the available slots.');
  const now = istNowParts();
  if (selected.delivery_date < now.date || selected.delivery_date > addDays(now.date, Number(settings.booking_horizon_days || 7)) ||
      (selected.delivery_date === now.date && Number(selected.start_minute) < now.minute + Number(settings.same_day_cutoff_minutes || 0))) {
    throw new Error('That delivery window has passed its booking cutoff. Choose another available window.');
  }
  const rows = await slotRows(env, selected.delivery_date, selected.delivery_date);
  const activeStores = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count || 0);
  const stock = await inventoryMap(env);
  const address = payload.address || {};
  const candidates = rows.filter(slot =>
    Number(slot.start_minute) === Number(selected.start_minute) &&
    Number(slot.end_minute) === Number(selected.end_minute) &&
    slotCanBeCustomerBooked(slot, settings, now) &&
    Number(slot.occupied) < Number(slot.capacity) &&
    distanceFor(address, slot, activeStores) !== Infinity &&
    inventoryFits(slot.store_id, items, stock)
  ).map(slot => ({ ...slot, distance_km: distanceFor(address, slot, activeStores) }));
  candidates.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0) || a.store_name.localeCompare(b.store_name));
  if (!candidates.length) throw new Error('That delivery window just became unavailable or the full basket is not available at an eligible store. Refresh slots and try another window.');
  const chosen = candidates[0];
  return {
    slotId: chosen.id, storeId: chosen.store_id, storeName: chosen.store_name, date: chosen.delivery_date,
    startMinute: Number(chosen.start_minute), endMinute: Number(chosen.end_minute),
    status: 'requested', deliveryPlan: chosen.delivery_date === now.date ? 'Today' : chosen.delivery_date === addDays(now.date, 1) ? 'Tomorrow' : 'Later'
  };
}
export function checkoutDeliveryStatements(env, orderId, delivery, items) {
  if (!delivery) return [];
  const statements = [
    env.DB.prepare('INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status,owner_override,override_reason) VALUES (?,?,?,\'reserved\',0,\'\')')
      .bind(id('slotres'), orderId, delivery.slotId),
    env.DB.prepare('INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,\'system\',?,\'delivery_requested\',\'\',NULL,?)')
      .bind(id('audit'), orderId, delivery.storeId, enc({ date: delivery.date, startMinute: delivery.startMinute, endMinute: delivery.endMinute, storeId: delivery.storeId, status: 'requested' }))
  ];
  for (const item of items.filter(itemNeedsStock)) {
    statements.push(env.DB.prepare(
      'INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason) VALUES (?,?,?,?,?,\'reserved\',0,\'\')'
    ).bind(id('stockres'), orderId, delivery.storeId, item.id, item.qty));
  }
  return statements;
}
async function writeAudit(env, orderId, actorType, actorId, action, reason, before, after) {
  await env.DB.prepare(
    'INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(id('audit'), orderId, actorType, actorId || '', action, reason || '', enc(before), enc(after)).run();
}
async function getOrderForAction(env, orderId, customerId = '') {
  const query = 'SELECT id,customer_id,delivery_status,payment_status,delivery_plan,scheduled_delivery_date,scheduled_slot_id,' +
    'assigned_store_id,scheduled_start_minute,scheduled_end_minute,schedule_status,is_test_order FROM orders WHERE id=?' +
    (customerId ? ' AND customer_id=?' : '') + ' LIMIT 1';
  return customerId ? env.DB.prepare(query).bind(orderId, customerId).first() : env.DB.prepare(query).bind(orderId).first();
}
function beforeCutoff(order, settings) {
  if (!['New', 'Confirmed'].includes(String(order.delivery_status || ''))) return false;
  if (!order.scheduled_delivery_date || order.scheduled_start_minute === null || order.scheduled_start_minute === undefined) return true;
  const now = istNowParts();
  if (order.scheduled_delivery_date < now.date) return false;
  if (order.scheduled_delivery_date > now.date) return true;
  return Number(order.scheduled_start_minute) >= now.minute + Number(settings.same_day_cutoff_minutes || 0);
}
async function queueRequest(env, order, customerId, requestType, body = {}) {
  const existing = await env.DB.prepare(
    'SELECT id,status,request_type,requested_slot_id,reason FROM order_action_requests WHERE order_id=? AND request_type=? AND status=\'pending\' ORDER BY created_at DESC LIMIT 1'
  ).bind(order.id, requestType).first();
  if (existing) return { requestId: existing.id, status: existing.status, requestType: existing.request_type, alreadyRequested: true };
  const requestId = id('request'), reason = clean(body.reason).slice(0, 500), requestedSlotId = clean(body.slotId || body.requestedSlotId) || null;
  const statements = [
    env.DB.prepare('INSERT INTO order_action_requests (id,order_id,customer_id,request_type,requested_slot_id,reason,status) VALUES (?,?,?,?,?,?,\'pending\')')
      .bind(requestId, order.id, customerId, requestType, requestedSlotId, reason),
    env.DB.prepare('INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,\'customer\',?,?,?, ?,?)')
      .bind(id('audit'), order.id, customerId, requestType + '_requested', reason, enc(order), enc({ requestId, requestType, requestedSlotId, status: 'pending' }))
  ];
  if (requestType === 'reschedule') {
    statements.push(env.DB.prepare('UPDATE orders SET schedule_status=\'change_requested\',updated_at=CURRENT_TIMESTAMP WHERE id=? AND customer_id=?')
      .bind(order.id, customerId));
  }
  try { await env.DB.batch(statements); }
  catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) {
      const latest = await env.DB.prepare('SELECT id,status,request_type FROM order_action_requests WHERE order_id=? AND request_type=? AND status=\'pending\' LIMIT 1').bind(order.id, requestType).first();
      if (latest) return { requestId: latest.id, status: latest.status, requestType: latest.request_type, alreadyRequested: true };
    }
    throw error;
  }
  return { requestId, status: 'pending', requestType, message: 'Your request was sent to FreshWay. The order has not been changed yet.' };
}
async function notifyCustomerAndOwner(env, orderId, before, action, reason, after = null) {
  const latest = after || await env.DB.prepare(
    'SELECT customer_id,delivery_status,payment_status,delivery_plan,is_test_order FROM orders WHERE id=?'
  ).bind(orderId).first();
  if (!latest || Number(latest.is_test_order || 0)) return;
  const alerts = buildOrderChangeAlerts(orderId, before, latest);
  alerts.push({
    audience: 'customer', customerId: latest.customer_id, orderId, eventType: action,
    title: 'FreshWay delivery update', body: reason || 'Your delivery details have been updated.',
    url: '/?openOrder=' + encodeURIComponent(orderId) + '#orders',
    eventKey: 'order:' + orderId + ':' + action + ':customer:' + Date.now()
  });
  alerts.push({
    audience: 'owner', customerId: '', orderId, eventType: action,
    title: 'OWNER · Delivery update', body: orderId + ': ' + (reason || action),
    url: '/admin/?openOrder=' + encodeURIComponent(orderId) + '#orders',
    eventKey: 'order:' + orderId + ':' + action + ':owner:' + Date.now()
  });
  await Promise.all(alerts.map(alert => dispatchOrderAlert(env, alert).catch(error => {
    console.error('FreshWay order action notification failed:', error?.message || error);
    return { status: 'failed' };
  })));
}
async function moveOrderSchedule(env, order, target, actorType, actorId, options = {}) {
  const owner = actorType === 'owner', override = owner && options.override === true;
  const reason = clean(options.reason).slice(0, 500);
  const before = { ...order };
  if (!target) throw new Error('Choose a valid delivery window.');
  const currentStatus = String(order.delivery_status || 'New');
  const targetDate = String(target.delivery_date || '');
  if (!dateValid(targetDate)) throw new Error('Invalid delivery date.');
  const start = int(target.start_minute, -1), end = int(target.end_minute, -1);
  if (start < 0 || start > 1439 || end <= start || end > 1440) throw new Error('Invalid delivery time window.');
  const selected = target.id ? target : null;
  if (!selected && !owner) throw new Error('Choose an available delivery window.');
  const now = istNowParts();
  const pastOrCutoff = targetDate < now.date || (targetDate === now.date && start < now.minute);
  const settings = await readSettings(env);
  const sameStoreCandidates = selected ? [selected] : [];
  let candidates = [];
  if (selected) {
    const rows = await slotRows(env, targetDate, targetDate);
    const activeStores = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count || 0);
    const stock = await inventoryMap(env, order.id);
    const lines = (await env.DB.prepare('SELECT product_id id,qty,stock_reserved_qty stockReservedQty FROM order_items WHERE order_id=?').bind(order.id).all()).results || [];
    candidates = rows.filter(slot => slot.id === selected.id || (override &&
      Number(slot.start_minute) === start && Number(slot.end_minute) === end))
      .map(slot => ({ ...slot, distance_km: distanceFor(options.address || {}, slot, activeStores) }))
      .filter(slot => owner || (slotCanBeCustomerBooked(slot, settings, now) &&
        Number(slot.occupied) < Number(slot.capacity) && slot.distance_km !== Infinity && inventoryFits(slot.store_id, lines, stock)));
    candidates.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0) || a.store_name.localeCompare(b.store_name));
  }
  let chosen = candidates[0] || null;
  const ownReservation = chosen ? await env.DB.prepare("SELECT COUNT(*) count FROM delivery_slot_reservations WHERE order_id=? AND slot_id=? AND status IN ('reserved','conflict')").bind(order.id, chosen.id).first() : null;
  const occupiedExcludingThisOrder = Math.max(0, Number(chosen?.occupied || 0) - Number(ownReservation?.count || 0));
  const slotConflict = !chosen || pastOrCutoff || !Number(chosen.is_active) || !Number(chosen.store_active) ||
    occupiedExcludingThisOrder >= Number(chosen.capacity);
  if (!chosen && !owner) throw new Error('That delivery window is no longer available. Refresh available slots.');
  if (!chosen && owner && selected) {
    const fallback = await env.DB.prepare('SELECT s.id,s.store_id,s.delivery_date,s.start_minute,s.end_minute,s.capacity,s.is_active,ds.name store_name,ds.latitude,ds.longitude,ds.service_radius_km,ds.is_active store_active FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.id=?').bind(selected.id).first();
    if (fallback) chosen = { ...fallback, occupied: 0 };
  }
  const newStoreId = chosen?.store_id || order.assigned_store_id || null;
  const newSlotId = chosen?.id || null;
  if (owner && override && !reason) throw new Error('Enter a reason for the Owner override.');
  if (owner && slotConflict && !override) throw new Error('This delivery window has a capacity, availability, date, or inventory conflict. Enable Owner override and add a reason to continue.');
  const status = currentStatus === 'Delivered' ? 'completed' :
    currentStatus === 'Cancelled' ? 'conflict' :
    slotConflict && owner && override ? 'conflict' : 'reserved';
  if (status === 'reserved' && !chosen) throw new Error('Choose an available delivery window.');
  const oldStore = order.assigned_store_id || null;
  const changingStore = !!(newStoreId && newStoreId !== oldStore);
  const lines = (await env.DB.prepare('SELECT product_id id,qty,stock_reserved_qty stockReservedQty FROM order_items WHERE order_id=?').bind(order.id).all()).results || [];
  const stock = await inventoryMap(env, order.id);
  let stockConflict = false;
  if (newStoreId) {
    stockConflict = !inventoryFits(newStoreId, lines, stock);
    if (stockConflict && !(owner && override)) throw new Error('That store cannot fulfil the full basket. Choose another available window.');
  }
  const statements = [];
  statements.push(env.DB.prepare('UPDATE delivery_slot_reservations SET status=\'released\',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN (\'reserved\',\'conflict\')').bind(order.id));
  if (changingStore) {
    statements.push(env.DB.prepare('UPDATE delivery_store_inventory_reservations SET status=\'released\',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN (\'reserved\',\'conflict\')').bind(order.id));
    if (newStoreId) {
      for (const line of lines.filter(itemNeedsStock)) {
        statements.push(env.DB.prepare(
          'INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(id('stockres'), order.id, newStoreId, line.id, Number(line.qty), stockConflict ? 'conflict' : 'reserved',
          stockConflict ? 1 : 0, stockConflict ? (reason || 'Owner override: insufficient store inventory') : ''));
      }
    }
  }
  if (chosen && status !== 'completed' && currentStatus !== 'Cancelled') {
    statements.push(env.DB.prepare(
      'INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status,owner_override,override_reason) VALUES (?,?,?,?,?,?)'
    ).bind(id('slotres'), order.id, chosen.id, status, override ? 1 : 0, override ? reason : ''));
  }
  const scheduleStatus = currentStatus === 'Cancelled' ? 'conflict' :
    currentStatus === 'Delivered' ? 'completed' :
    (slotConflict || stockConflict || !newStoreId) ? 'conflict' : actorType === 'customer' && currentStatus === 'New' ? 'requested' : 'confirmed';
  statements.push(env.DB.prepare(
    'UPDATE orders SET scheduled_delivery_date=?,scheduled_slot_id=?,assigned_store_id=?,scheduled_start_minute=?,scheduled_end_minute=?,schedule_status=?,delivery_plan=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(targetDate, chosen?.id || null, newStoreId, start, end, scheduleStatus,
    targetDate === now.date ? 'Today' : targetDate === addDays(now.date, 1) ? 'Tomorrow' : 'Later', order.id));
  statements.push(env.DB.prepare(
    'INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(id('audit'), order.id, actorType, actorId || '', actorType === 'owner' ? 'delivery_rescheduled_by_owner' : 'delivery_rescheduled_by_customer',
    reason, enc(before), enc({ date: targetDate, startMinute: start, endMinute: end, slotId: newSlotId, storeId: newStoreId, status: scheduleStatus })));
  if (slotConflict || stockConflict || !newStoreId || currentStatus === 'Cancelled') {
    const type = stockConflict ? 'store_stock_shortfall' : slotConflict ? 'slot_overbooked_or_inactive' : 'delivery_unassigned';
    statements.push(env.DB.prepare(
      'INSERT INTO order_operational_flags (id,order_id,flag_type,status,details_json) VALUES (?,?,?,\'open\',?) ' +
      'ON CONFLICT DO NOTHING'
    ).bind(id('flag'), order.id, type, enc({ reason: reason || 'Owner schedule override', date: targetDate, startMinute: start, endMinute: end, storeId: newStoreId })));
  }
  try { await env.DB.batch(statements); }
  catch (error) {
    if (/DELIVERY_SLOT_FULL|DELIVERY_SLOT_CLOSED/i.test(String(error?.message || ''))) {
      throw new Error('ORDER_CONFLICT: That delivery window was just filled. Refresh and choose another slot.');
    }
    if (/DELIVERY_STORE_STOCK_LOW/i.test(String(error?.message || ''))) throw new Error('ORDER_CONFLICT: That store no longer has enough stock for this order.');
    throw error;
  }
  const after = await getOrderForAction(env, order.id);
  await notifyCustomerAndOwner(env, order.id, {
    customer_id: order.customer_id, delivery_status: order.delivery_status, payment_status: order.payment_status,
    delivery_plan: order.delivery_plan, is_test_order: order.is_test_order
  }, 'delivery_schedule_changed', 'Delivery scheduled for ' + targetDate + ' ' + formatTimeMinutes(start) + '–' + formatTimeMinutes(end) + (scheduleStatus === 'conflict' ? ' (Owner override/conflict)' : ''), {
    customer_id: order.customer_id, delivery_status: order.delivery_status, payment_status: order.payment_status,
    delivery_plan: after?.delivery_plan, is_test_order: order.is_test_order
  });
  return { ok: true, orderId: order.id, scheduledDelivery: { date: targetDate, startMinute: start, endMinute: end, startTime: formatTimeMinutes(start), endTime: formatTimeMinutes(end), slotId: newSlotId, storeId: newStoreId, status: scheduleStatus }, warning: scheduleStatus === 'conflict' ? 'Schedule saved with an operational conflict. Review the conflict queue.' : '' };
}
async function customerAction(request, env, customerId, orderId, action) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const order = await getOrderForAction(env, orderId, customerId);
  if (!order || Number(order.is_test_order || 0)) return response({ error: 'Order was not found in your account.' }, 404);
  const settings = await readSettings(env);
  if (action === 'cancel') {
    if (order.delivery_status === 'Cancelled') return response({ ok: true, status: 'Cancelled', alreadyCancelled: true });
    if (order.delivery_status === 'Delivered') return response({ error: 'Delivered orders cannot be cancelled here. Submit an issue or return request instead.' }, 409);
    if (!beforeCutoff(order, settings)) {
      const queued = await queueRequest(env, order, customerId, 'cancellation', body);
      return response({ ok: true, request: queued, status: order.delivery_status }, 202);
    }
    const before = {
      customer_id: order.customer_id, delivery_status: order.delivery_status, payment_status: order.payment_status,
      delivery_plan: order.delivery_plan, is_test_order: order.is_test_order
    };
    const cancelReason = clean(body.reason).slice(0, 500) || 'Requested by customer';
    const changed = await updateOrder(env, order.id, { status: 'Cancelled' }, {
      actorType: 'customer', actorId: customerId, reason: cancelReason
    });
    const after = await env.DB.prepare('SELECT customer_id,delivery_status,payment_status,delivery_plan,is_test_order FROM orders WHERE id=?').bind(order.id).first();
    await notifyCustomerAndOwner(env, order.id, before, 'order_cancelled_by_customer', 'Your order has been cancelled.', after);
    return response({ ok: true, status: changed.status, message: 'Your order has been cancelled.' });
  }
  if (action === 'reschedule') {
    const slotId = clean(body.slotId);
    if (!slotId) return response({ error: 'Choose an available delivery window.' }, 400);
    const selected = await env.DB.prepare(
      'SELECT s.id,s.store_id,s.delivery_date,s.start_minute,s.end_minute,s.capacity,s.is_active,ds.name store_name,ds.latitude,ds.longitude,ds.service_radius_km,ds.is_active store_active FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.id=? LIMIT 1'
    ).bind(slotId).first();
    if (!selected) return response({ error: 'That delivery window is no longer available.' }, 409);
    if (order.delivery_status === 'Delivered' || order.delivery_status === 'Cancelled') return response({ error: 'This order cannot be rescheduled in its current status. Submit an issue or return request if it was delivered.' }, 409);
    if (!beforeCutoff(order, settings)) {
      const queued = await queueRequest(env, order, customerId, 'reschedule', { ...body, slotId });
      return response({ ok: true, request: queued, status: order.delivery_status }, 202);
    }
    const slots = await resolveAvailableSlots(env, { address: body.address || {}, items: body.items || [] }, selected.delivery_date, order.id);
    const valid = slots.slots.some(slot => slot.date === selected.delivery_date &&
      slot.startMinute === Number(selected.start_minute) && slot.endMinute === Number(selected.end_minute));
    if (!valid) return response({ error: 'That delivery window is full or cannot fulfil the full basket. Choose another window.' }, 409);
    const result = await moveOrderSchedule(env, order, selected, 'customer', customerId, { address: body.address || {} });
    return response(result);
  }
  if (action === 'request') {
    const requestType = clean(body.requestType);
    if (!['cancellation','reschedule','return','issue'].includes(requestType)) return response({ error: 'Choose a valid order request type.' }, 400);
    if (requestType === 'return' && order.delivery_status !== 'Delivered') return response({ error: 'Return requests are available after delivery. For an active order, request cancellation.' }, 409);
    const queued = await queueRequest(env, order, customerId, requestType, body);
    return response({ ok: true, request: queued }, 202);
  }
  return response({ error: 'Unsupported order action.' }, 404);
}

export async function handleCustomerDeliveryRequest(request, env, customerId) {
  const url = new URL(request.url);
  if (url.pathname === '/api/delivery/slots' && request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    try { return response(await resolveAvailableSlots(env, body, clean(body.date))); }
    catch (error) { return response({ error: error.message || 'Could not load available delivery windows.' }, 400); }
  }
  const match = url.pathname.match(/^\/api\/orders\/([^/]+)\/(cancel|reschedule|request)$/);
  if (match && request.method === 'POST') {
    let orderId;
    try { orderId = decodeURIComponent(match[1]); } catch (_) { return response({ error: 'Order was not found.' }, 404); }
    try { return await customerAction(request, env, customerId, orderId, match[2]); }
    catch (error) {
      console.error('FreshWay customer order action failed:', error?.message || error);
      if (/ORDER_CONFLICT:/.test(String(error?.message || ''))) return response({ error: String(error.message).replace(/^ORDER_CONFLICT:\s*/, ''), code: 'ORDER_CONFLICT' }, 409);
      return response({ error: error.message || 'Could not update this order. Refresh and try again.' }, 400);
    }
  }
  return null;
}

async function inventoryAvailabilityForStore(env, storeId) {
  return (await env.DB.prepare(
    'SELECT p.id,p.name,p.unit,p.price,p.stock_managed,p.stock_quantity,p.low_stock_threshold,' +
    'COALESCE(i.stock_quantity,0) on_hand,' +
    'COALESCE((SELECT SUM(r.qty) FROM delivery_store_inventory_reservations r WHERE r.store_id=? AND r.product_id=p.id AND r.status IN (\'reserved\',\'conflict\')),0) reserved_qty ' +
    'FROM products p LEFT JOIN delivery_store_inventory i ON i.product_id=p.id AND i.store_id=? ORDER BY p.name'
  ).bind(storeId, storeId).all()).results || [];
}
async function auditOwnerAction(env, order, actorId, action, reason, after) {
  await writeAudit(env, order.id, 'owner', actorId, action, reason, order, after);
}
export async function handleAdminDeliveryRequest(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/admin/delivery' && request.method === 'GET') {
    await ensureStoreInventoryRows(env);
    const settings = await readSettings(env);
    const stores = (await env.DB.prepare('SELECT * FROM delivery_stores ORDER BY is_active DESC,name').all()).results || [];
    const products = (await env.DB.prepare('SELECT id,name,unit,price,stock_managed,stock_quantity,low_stock_threshold,active FROM products ORDER BY name').all()).results || [];
    const inventory = (await env.DB.prepare(
      'SELECT i.store_id,i.product_id,p.name product_name,p.unit,p.stock_managed,i.stock_quantity,'+
      'COALESCE(SUM(CASE WHEN r.status IN (\'reserved\',\'conflict\') THEN r.qty ELSE 0 END),0) reserved_qty,'+
      'MAX(0,i.stock_quantity-COALESCE(SUM(CASE WHEN r.status IN (\'reserved\',\'conflict\') THEN r.qty ELSE 0 END),0)) available_qty '+
      'FROM delivery_store_inventory i JOIN products p ON p.id=i.product_id '+
      'LEFT JOIN delivery_store_inventory_reservations r ON r.store_id=i.store_id AND r.product_id=i.product_id '+
      'GROUP BY i.store_id,i.product_id ORDER BY i.store_id,p.name'
    ).all()).results || [];
    const operationalFlags = (await env.DB.prepare(
      "SELECT f.id,f.order_id,f.flag_type,f.details_json,f.created_at,o.delivery_status,o.customer_name FROM order_operational_flags f JOIN orders o ON o.id=f.order_id WHERE f.status='open' ORDER BY f.created_at DESC LIMIT 100"
    ).all()).results || [];
    const now = istNowParts();
    const slots = await env.DB.prepare(
      'SELECT s.*,ds.name store_name,(SELECT COUNT(*) FROM delivery_slot_reservations r WHERE r.slot_id=s.id AND r.status IN (\'reserved\',\'conflict\')) occupied ' +
      'FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.delivery_date>=? AND s.delivery_date<=? ORDER BY s.delivery_date,s.start_minute,ds.name LIMIT 500'
    ).bind(now.date, addDays(now.date, 60)).all();
    const requests = await env.DB.prepare(
      'SELECT r.id,r.order_id,r.customer_id,r.request_type,r.requested_slot_id,r.reason,r.status,r.resolution_note,r.created_at,r.updated_at,' +
      'o.delivery_status,o.total,o.scheduled_delivery_date,o.scheduled_start_minute,o.scheduled_end_minute,o.customer_name,c.phone customer_phone ' +
      'FROM order_action_requests r JOIN orders o ON o.id=r.order_id LEFT JOIN customers c ON c.id=r.customer_id ' +
      'WHERE r.status=\'pending\' ORDER BY r.created_at LIMIT 200'
    ).all();
    return response({ ok: true, settings, stores, products, inventory, operationalFlags, slots: slots.results || [], requests: requests.results || [] });
  }
  if (path === '/api/admin/delivery' && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const enabled = body.enabled ? 1 : 0;
    const horizon = int(body.bookingHorizonDays, 7), cutoff = int(body.sameDayCutoffMinutes, 120);
    if (horizon < 1 || horizon > 60) throw new Error('Invalid booking horizon.');
    if (cutoff < 0 || cutoff > 1440) throw new Error('Invalid same-day cancellation cutoff.');
    if (enabled) {
      const stores = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count || 0);
      const slots = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_slots s JOIN delivery_stores d ON d.id=s.store_id WHERE s.is_active=1 AND d.is_active=1 AND s.delivery_date>=?').bind(istNowParts().date).first())?.count || 0);
      if (!stores || !slots) throw new Error('Configure at least one active store and future delivery slot before enabling scheduling.');
    }
    await env.DB.prepare('UPDATE delivery_scheduling_settings SET enabled=?,booking_horizon_days=?,same_day_cutoff_minutes=?,timezone=\'Asia/Kolkata\',updated_at=CURRENT_TIMESTAMP WHERE id=1').bind(enabled, horizon, cutoff).run();
    return response({ ok: true, settings: await readSettings(env) });
  }
  if (path === '/api/admin/delivery/stores' && request.method === 'POST') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const name = clean(body.name).slice(0, 120), address = clean(body.address).slice(0, 300);
    const latitude = Number(body.latitude), longitude = Number(body.longitude), radius = Number(body.serviceRadiusKm ?? 10);
    if (!name) throw new Error('Enter the store name.');
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Enter valid store map coordinates.');
    if (!Number.isFinite(radius) || radius < 0.1 || radius > 100) throw new Error('Invalid store delivery radius.');
    const storeId = id('store');
    const count = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count || 0);
    const statements = [env.DB.prepare('INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES (?,?,?,?,?,?,1)').bind(storeId, name, address, latitude, longitude, radius)];
    const inventorySeed = count ? 0 : null;
    if (inventorySeed === null) {
      statements.push(env.DB.prepare('INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT ?,id,stock_quantity FROM products WHERE stock_managed=1').bind(storeId));
    } else {
      statements.push(env.DB.prepare('INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT ?,id,0 FROM products WHERE stock_managed=1').bind(storeId));
    }
    await env.DB.batch(statements);
    return response({ ok: true, store: { id: storeId, name, address, latitude, longitude, service_radius_km: radius, is_active: 1 }, initialInventory: inventorySeed === null ? 'copied-current-global-available-stock' : 'zero-stock-requires-setup' }, 201);
  }
  const storeMatch = path.match(new RegExp('^/api/admin/delivery/stores/([^/]+)$'));
  if (storeMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const storeId = decodeURIComponent(storeMatch[1]);
    const current = await env.DB.prepare('SELECT * FROM delivery_stores WHERE id=?').bind(storeId).first();
    if (!current) throw new Error('Delivery store not found.');
    const name = clean(body.name === undefined ? current.name : body.name).slice(0, 120);
    const address = clean(body.address === undefined ? current.address : body.address).slice(0, 300);
    const latitude = Number(body.latitude === undefined ? current.latitude : body.latitude);
    const longitude = Number(body.longitude === undefined ? current.longitude : body.longitude);
    const radius = Number(body.serviceRadiusKm === undefined ? current.service_radius_km : body.serviceRadiusKm);
    const active = body.isActive === undefined ? Number(current.is_active) : body.isActive ? 1 : 0;
    if (!name) throw new Error('Enter the store name.');
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Enter valid store map coordinates.');
    if (!Number.isFinite(radius) || radius < 0.1 || radius > 100) throw new Error('Invalid store delivery radius.');
    await env.DB.prepare('UPDATE delivery_stores SET name=?,address=?,latitude=?,longitude=?,service_radius_km=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(name,address,latitude,longitude,radius,active,storeId).run();
    return response({ ok: true, store: { ...current, name, address, latitude, longitude, service_radius_km: radius, is_active: active } });
  }
  const inventoryMatch = path.match(new RegExp('^/api/admin/delivery/stores/([^/]+)/inventory$'));
  if (inventoryMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const storeId = decodeURIComponent(inventoryMatch[1]);
    const store = await env.DB.prepare('SELECT id FROM delivery_stores WHERE id=?').bind(storeId).first();
    if (!store) throw new Error('Delivery store not found.');
    await ensureStoreInventoryRows(env);
    if (!Array.isArray(body.items) || body.items.length > 500) throw new Error('Enter a valid store inventory list.');
    const productRows = (await env.DB.prepare('SELECT id,stock_managed FROM products WHERE stock_managed=1').all()).results || [];
    const requested = new Map();
    for (const item of body.items) {
      const productId = clean(item.productId || item.id), quantity = Number(item.stockQuantity ?? item.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity < 0 || requested.has(productId)) throw new Error('Invalid store inventory quantity.');
      requested.set(productId, quantity);
    }
    if (productRows.some(row => !requested.has(row.id)) || [...requested.keys()].some(productId => !productRows.some(row => row.id === productId))) {
      throw new Error('Provide an inventory quantity for every stock-managed product.');
    }
    const activeReservations = (await env.DB.prepare(
      'SELECT product_id,SUM(qty) qty FROM delivery_store_inventory_reservations WHERE store_id=? AND status IN (\'reserved\',\'conflict\') GROUP BY product_id'
    ).bind(storeId).all()).results || [];
    const reserved = new Map(activeReservations.map(row => [row.product_id, Number(row.qty || 0)]));
    for (const [productId, quantity] of requested) {
      if (quantity < (reserved.get(productId) || 0)) throw new Error('Stock on hand cannot be lower than active reservations.');
    }
    const statements = [];
    for (const [productId, quantity] of requested) {
      statements.push(env.DB.prepare('UPDATE delivery_store_inventory SET stock_quantity=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND product_id=?')
        .bind(quantity, storeId, productId));
    }
    for (const row of productRows) {
      statements.push(env.DB.prepare(
        'UPDATE products SET stock_quantity=MAX(0,(SELECT COALESCE(SUM(i.stock_quantity),0) FROM delivery_store_inventory i WHERE i.product_id=?)-' +
        '(SELECT COALESCE(SUM(r.qty),0) FROM delivery_store_inventory_reservations r WHERE r.product_id=? AND r.status IN (\'reserved\',\'conflict\'))),updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).bind(row.id, row.id, row.id));
    }
    await env.DB.batch(statements);
    return response({ ok: true, inventory: await inventoryAvailabilityForStore(env, storeId) });
  }
  const slotCollection = path === '/api/admin/delivery/slots';
  if (slotCollection && request.method === 'GET') {
    const from = clean(url.searchParams.get('from')) || istNowParts().date;
    const to = clean(url.searchParams.get('to')) || addDays(from, 14);
    if (!dateValid(from) || !dateValid(to) || to < from || to > addDays(from, 60)) throw new Error('Invalid delivery slot date range.');
    return response({ slots: (await env.DB.prepare(
      'SELECT s.*,ds.name store_name,(SELECT COUNT(*) FROM delivery_slot_reservations r WHERE r.slot_id=s.id AND r.status IN (\'reserved\',\'conflict\')) occupied ' +
      'FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.delivery_date>=? AND s.delivery_date<=? ORDER BY s.delivery_date,s.start_minute,ds.name'
    ).bind(from, to).all()).results || [] });
  }
  if (slotCollection && request.method === 'POST') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const storeId = clean(body.storeId), from = clean(body.fromDate), to = clean(body.toDate);
    const start = parseTimeMinutes(body.startTime), end = parseTimeMinutes(body.endTime), capacity = int(body.capacity, 0);
    const weekdays = Array.isArray(body.weekdays) ? new Set(body.weekdays.map(v => int(v, -1))) : new Set([0,1,2,3,4,5,6]);
    if (!await env.DB.prepare('SELECT id FROM delivery_stores WHERE id=? AND is_active=1').bind(storeId).first()) throw new Error('Choose an active delivery store.');
    if (!dateValid(from) || !dateValid(to) || to < from || to > addDays(from, 60)) throw new Error('Invalid delivery slot date range.');
    if (start === null || end === null || end <= start) throw new Error('Enter a valid delivery start and end time.');
    if (capacity < 1 || capacity > 500) throw new Error('Invalid delivery slot capacity.');
    const countDays = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
    const statements = [];
    for (let i = 0; i < countDays; i++) {
      const date = addDays(from, i), day = new Date(date + 'T00:00:00Z').getUTCDay();
      if (!weekdays.has(day)) continue;
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO delivery_slots (id,store_id,delivery_date,start_minute,end_minute,capacity,is_active) VALUES (?,?,?,?,?,?,1)')
        .bind(id('slot'), storeId, date, start, end, capacity));
    }
    if (!statements.length) throw new Error('Choose at least one weekday for the delivery schedule.');
    await env.DB.batch(statements);
    const slots = await env.DB.prepare('SELECT COUNT(*) count FROM delivery_slots WHERE store_id=? AND delivery_date>=? AND delivery_date<=? AND start_minute=? AND end_minute=?').bind(storeId, from, to, start, end).first();
    return response({ ok: true, createdOrExisting: Number(slots?.count || 0), storeId, fromDate: from, toDate: to, startTime: body.startTime, endTime: body.endTime }, 201);
  }
  const slotMatch = path.match(new RegExp('^/api/admin/delivery/slots/([^/]+)$'));
  if (slotMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const slotId = decodeURIComponent(slotMatch[1]);
    const current = await env.DB.prepare('SELECT * FROM delivery_slots WHERE id=?').bind(slotId).first();
    if (!current) throw new Error('Delivery slot not found.');
    const capacity = body.capacity === undefined ? Number(current.capacity) : int(body.capacity, 0);
    const active = body.isActive === undefined ? Number(current.is_active) : body.isActive ? 1 : 0;
    if (capacity < 1 || capacity > 500) throw new Error('Invalid delivery slot capacity.');
    await env.DB.prepare('UPDATE delivery_slots SET capacity=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(capacity, active, slotId).run();
    const count = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_slot_reservations WHERE slot_id=? AND status IN (\'reserved\',\'conflict\')').bind(slotId).first())?.count || 0);
    return response({ ok: true, slot: { ...current, capacity, is_active: active, occupied: count, overbooked: count > capacity }, warning: count > capacity ? 'Existing reservations exceed this slot capacity.' : '' });
  }
  const orderHistoryMatch = path.match(new RegExp('^/api/admin/delivery/orders/([^/]+)/history$'));
  if (orderHistoryMatch && request.method === 'GET') {
    const orderId = decodeURIComponent(orderHistoryMatch[1]);
    const order = await getOrderForAction(env, orderId);
    if (!order) throw new Error('Order not found.');
    const events = (await env.DB.prepare('SELECT id,actor_type,actor_id,action,reason,before_json,after_json,created_at FROM order_audit_events WHERE order_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(orderId).all()).results || [];
    const flags = (await env.DB.prepare("SELECT id,flag_type,status,details_json,created_at,updated_at FROM order_operational_flags WHERE order_id=? ORDER BY created_at DESC").bind(orderId).all()).results || [];
    const reservations = (await env.DB.prepare("SELECT r.id,r.status,r.owner_override,r.override_reason,r.updated_at,s.delivery_date,s.start_minute,s.end_minute,ds.name store_name FROM delivery_slot_reservations r LEFT JOIN delivery_slots s ON s.id=r.slot_id LEFT JOIN delivery_stores ds ON ds.id=s.store_id WHERE r.order_id=? ORDER BY r.created_at DESC LIMIT 30").bind(orderId).all()).results || [];
    return response({ ok: true, order, events, flags, reservations });
  }
  const scheduleMatch = path.match(new RegExp('^/api/admin/delivery/orders/([^/]+)/schedule$'));
  if (scheduleMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const orderId = decodeURIComponent(scheduleMatch[1]);
    const order = await getOrderForAction(env, orderId);
    if (!order) throw new Error('Order not found.');
    const slotId = clean(body.slotId);
    let target = null;
    if (slotId) {
      target = await env.DB.prepare(
        'SELECT s.id,s.store_id,s.delivery_date,s.start_minute,s.end_minute,s.capacity,s.is_active,ds.name store_name,ds.latitude,ds.longitude,ds.service_radius_km,ds.is_active store_active,' +
        '(SELECT COUNT(*) FROM delivery_slot_reservations r WHERE r.slot_id=s.id AND r.status IN (\'reserved\',\'conflict\')) occupied ' +
        'FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.id=? LIMIT 1'
      ).bind(slotId).first();
      if (!target) throw new Error('Choose a valid delivery window.');
    } else {
      const date = clean(body.deliveryDate), start = parseTimeMinutes(body.startTime), end = parseTimeMinutes(body.endTime);
      if (!dateValid(date) || start === null || end === null || end <= start) throw new Error('Enter a valid custom delivery date and time window.');
      target = { delivery_date: date, start_minute: start, end_minute: end, id: null, store_id: clean(body.storeId) || order.assigned_store_id || null, is_active: 1, store_active: 1, capacity: 0, occupied: 0 };
      if (target.store_id && !await env.DB.prepare('SELECT id FROM delivery_stores WHERE id=?').bind(target.store_id).first()) throw new Error('Choose a valid delivery store.');
    }
    const result = await moveOrderSchedule(env, order, target, 'owner', clean(request.headers.get('X-Freshway-Owner-Id')) || 'owner', { override: body.override === true, reason: clean(body.reason), address: body.address || {} });
    return response(result);
  }
  if (path === '/api/admin/delivery/requests' && request.method === 'GET') {
    return response({ requests: (await env.DB.prepare(
      'SELECT r.*,o.delivery_status,o.total,o.scheduled_delivery_date,o.scheduled_start_minute,o.scheduled_end_minute,o.customer_name,c.phone customer_phone ' +
      'FROM order_action_requests r JOIN orders o ON o.id=r.order_id LEFT JOIN customers c ON c.id=r.customer_id ' +
      'WHERE r.status=\'pending\' ORDER BY r.created_at LIMIT 200'
    ).all()).results || [] });
  }
  const requestMatch = path.match(new RegExp('^/api/admin/delivery/requests/([^/]+)$'));
  if (requestMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const requestId = decodeURIComponent(requestMatch[1]), decision = clean(body.decision), note = clean(body.note).slice(0, 500);
    if (!['approve','reject','complete'].includes(decision)) throw new Error('Choose approve, reject, or complete.');
    const row = await env.DB.prepare('SELECT * FROM order_action_requests WHERE id=?').bind(requestId).first();
    if (!row) throw new Error('Order request not found.');
    if (row.status !== 'pending' && !(decision === 'complete' && row.status === 'approved')) throw new Error('This request has already been resolved.');
    if (decision === 'approve' && row.request_type === 'cancellation') {
      const beforeOrder = await getOrderForAction(env, row.order_id);
      await updateOrder(env, row.order_id, { status: 'Cancelled' });
      const afterOrder = await env.DB.prepare('SELECT customer_id,delivery_status,payment_status,delivery_plan,is_test_order FROM orders WHERE id=?').bind(row.order_id).first();
      if (beforeOrder && afterOrder) await notifyCustomerAndOwner(env, row.order_id, { customer_id:beforeOrder.customer_id,delivery_status:beforeOrder.delivery_status,payment_status:beforeOrder.payment_status,delivery_plan:beforeOrder.delivery_plan,is_test_order:beforeOrder.is_test_order }, 'order_cancellation_request_approved', 'Your cancellation request has been approved.', afterOrder);
    } else if (decision === 'approve' && row.request_type === 'reschedule') {
      if (!row.requested_slot_id) throw new Error('This reschedule request has no target delivery window.');
      const order = await getOrderForAction(env, row.order_id);
      const target = await env.DB.prepare(
        'SELECT s.id,s.store_id,s.delivery_date,s.start_minute,s.end_minute,s.capacity,s.is_active,ds.name store_name,ds.latitude,ds.longitude,ds.service_radius_km,ds.is_active store_active,' +
        '(SELECT COUNT(*) FROM delivery_slot_reservations r WHERE r.slot_id=s.id AND r.status IN (\'reserved\',\'conflict\')) occupied ' +
        'FROM delivery_slots s JOIN delivery_stores ds ON ds.id=s.store_id WHERE s.id=?'
      ).bind(row.requested_slot_id).first();
      if (!order || !target) throw new Error('The order or requested delivery window could not be found.');
      await moveOrderSchedule(env, order, target, 'owner', 'owner', { override: body.override === true, reason: note });
    } else if (decision === 'approve' && row.request_type === 'return') {
      // Approving a return request is a decision, not proof that goods were physically
      // returned or suitable for restocking. Owner must use the stock correction workflow.
      await writeAudit(env, row.order_id, 'owner', 'owner', 'return_request_approved', note, row, { status: 'approved' });
    }
    if (decision === 'reject' && row.request_type === 'reschedule') {
      const order = await getOrderForAction(env, row.order_id);
      if (order && order.schedule_status === 'change_requested') {
        const restoredScheduleStatus = order.scheduled_slot_id
          ? (order.delivery_status === 'New' ? 'requested' : 'confirmed')
          : 'unscheduled';
        await env.DB.prepare(
          'UPDATE orders SET schedule_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND schedule_status=\'change_requested\''
        ).bind(restoredScheduleStatus, row.order_id).run();
        await writeAudit(env, row.order_id, 'owner', 'owner', 'reschedule_request_rejected_schedule_restored',
          note, { schedule_status: order.schedule_status }, { schedule_status: restoredScheduleStatus });
      }
    }
    const nextStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'completed';
    await env.DB.prepare('UPDATE order_action_requests SET status=?,resolution_note=?,resolved_by=\'owner\',updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(nextStatus, note, requestId).run();
    const latest = await getOrderForAction(env, row.order_id);
    await writeAudit(env, row.order_id, 'owner', 'owner', 'order_request_' + nextStatus, note, row, { status: nextStatus, order: latest });
    return response({ ok: true, requestId, status: nextStatus, orderStatus: latest?.delivery_status });
  }
  const flagMatch = path.match(new RegExp('^/api/admin/delivery/flags/([^/]+)$'));
  if (flagMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const flagId = decodeURIComponent(flagMatch[1]), note = clean(body.note).slice(0,500);
    if (clean(body.status) !== 'resolved') throw new Error('Choose resolved as the exception status.');
    if (!note) throw new Error('Enter a short note describing what was reviewed.');
    const flag = await env.DB.prepare('SELECT * FROM order_operational_flags WHERE id=?').bind(flagId).first();
    if (!flag) throw new Error('Delivery exception not found.');
    if (flag.status === 'resolved') return response({ok:true,alreadyResolved:true,status:'resolved'});
    await env.DB.prepare('UPDATE order_operational_flags SET status=\'resolved\',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=\'open\'').bind(flagId).run();
    await writeAudit(env, flag.order_id, 'owner', clean(request.headers.get('X-Freshway-Owner-Id')) || 'owner', 'operational_flag_resolved', note, flag, {...flag,status:'resolved'});
    return response({ok:true,status:'resolved',flagId});
  }
  return null;
}
