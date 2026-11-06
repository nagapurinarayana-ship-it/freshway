import { updateOrder } from './admin-orders.js';
import { buildOrderChangeAlerts } from './admin-notifications.js';
import { dispatchOrderAlert } from './order-alerts.js';
import { getStoreCatalogueRows, saveStoreCatalogue } from './store-catalogue.js';

const enc = value => JSON.stringify(value ?? null);
const clean = value => String(value ?? '').trim();
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
});
const deliverySchemaMissing = error => /no such table:\s*(?:delivery_scheduling_settings|delivery_stores|delivery_store_inventory|delivery_store_catalogue|delivery_slots|delivery_slot_reservations|delivery_store_inventory_reservations|order_action_requests|order_audit_events|order_operational_flags)\b/i.test(String(error?.message || error || ''));
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
  const rawLat=address.latitude??address.lat,rawLng=address.longitude??address.lng;
  if(rawLat===undefined||rawLat===null||rawLat===''||rawLng===undefined||rawLng===null||rawLng==='')return false;
  const lat=Number(rawLat),lng=Number(rawLng);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0);
}
function addressCoordinates(address = {}) { return {latitude:Number(address.latitude??address.lat),longitude:Number(address.longitude??address.lng)}; }
function distanceFor(address,store) {
  if(!hasCoordinates(address))return Infinity;
  const p=addressCoordinates(address),d=distanceKm(p.latitude,p.longitude,store.latitude,store.longitude);
  return d!==null&&d<=Number(store.service_radius_km)?d:Infinity;
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
async function ensureStoreInventoryRows(env) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) ' +
    'SELECT s.id,p.id,0 FROM delivery_stores s CROSS JOIN products p WHERE p.stock_managed=1'
  ).run();
}
async function inventoryMap(env, excludeOrderId = '') {
  const sql = excludeOrderId
    ? 'SELECT i.store_id,i.product_id,i.stock_quantity,COALESCE(SUM(CASE WHEN r.status IN (\'reserved\',\'conflict\') THEN r.qty ELSE 0 END),0) reserved_qty ' +
      'FROM delivery_store_inventory i LEFT JOIN delivery_store_inventory_reservations r ON r.store_id=i.store_id AND r.product_id=i.product_id AND r.order_id<>? ' +
      'GROUP BY i.store_id,i.product_id'
    : 'SELECT i.store_id,i.product_id,i.stock_quantity,COALESCE(SUM(CASE WHEN r.status IN (\'reserved\',\'conflict\') THEN r.qty ELSE 0 END),0) reserved_qty ' +
      'FROM delivery_store_inventory i LEFT JOIN delivery_store_inventory_reservations r ON r.store_id=i.store_id AND r.product_id=i.product_id ' +
      'GROUP BY i.store_id,i.product_id';
  const query=env.DB.prepare(sql);
  const rows=(await (excludeOrderId?query.bind(excludeOrderId):query).all()).results||[];
  const map=new Map();
  for(const row of rows)map.set(row.store_id+'|'+row.product_id,{quantity:Number(row.stock_quantity||0),reserved:Number(row.reserved_qty||0)});
  return map;
}
function itemNeedsStock(item) {
  const managed=item.stock_managed??item.stockManaged;
  if(managed!==undefined&&managed!==null)return Number(managed)===1||managed===true;
  return Number(item.stockReservedQty??item.stock_reserved_qty??0)>0;
}
function inventoryFits(storeId, items, stock) {
  return items.filter(itemNeedsStock).every(item => {
    const row = stock.get(storeId + '|' + String(item.id ?? item.product_id));
    return !!row && row.quantity - row.reserved >= Number(item.qty || 0);
  });
}
async function storeFulfilmentMap(env, storeIds, items, excludeOrderId = '') {
  const stores=[...new Set((storeIds||[]).map(String))];
  const products=[...new Set((items||[]).map(item=>String(item.id??item.product_id)))];
  if(!stores.length||!products.length)return new Map();
  const storeSlots=stores.map(()=>'?').join(','),productSlots=products.map(()=>'?').join(',');
  const excludeReservation=excludeOrderId?' AND r.order_id<>?':'';
  const params=[...(excludeOrderId?[excludeOrderId]:[]),...stores,...products];
  const rows=(await env.DB.prepare(
    'SELECT sc.store_id,sc.product_id,sc.is_available,p.active,c.active category_active,p.stock_managed,'+
    'COALESCE(i.stock_quantity,0) on_hand,'+
    'COALESCE((SELECT SUM(r.qty) FROM delivery_store_inventory_reservations r '+
    "WHERE r.store_id=sc.store_id AND r.product_id=sc.product_id AND r.status IN ('reserved','conflict')"+excludeReservation+'),0) reserved_qty '+
    'FROM delivery_store_catalogue sc JOIN products p ON p.id=sc.product_id '+
    'JOIN categories c ON c.id=p.category_id '+
    'LEFT JOIN delivery_store_inventory i ON i.store_id=sc.store_id AND i.product_id=sc.product_id '+
    'WHERE sc.store_id IN ('+storeSlots+') AND sc.product_id IN ('+productSlots+')'
  ).bind(...params).all()).results||[];
  const byStore=new Map();
  for(const row of rows){
    const storeId=String(row.store_id);
    if(!byStore.has(storeId))byStore.set(storeId,new Map());
    byStore.get(storeId).set(String(row.product_id),row);
  }
  return byStore;
}
function storeCanFulfil(storeId,items,byStore){
  const products=byStore.get(String(storeId));
  if(!products)return false;
  return items.every(item=>{
    const row=products.get(String(item.id??item.product_id));
    if(!row||Number(row.is_available)!==1||Number(row.active)!==1||Number(row.category_active)!==1)return false;
    if(Number(row.stock_managed)!==1)return true;
    return Math.max(0,Number(row.on_hand||0)-Number(row.reserved_qty||0))>=Number(item.qty||0);
  });
}
async function storesWithAvailableProducts(env,storeIds){
  const stores=[...new Set((storeIds||[]).map(String))];
  if(!stores.length)return new Set();
  const placeholders=stores.map(()=>'?').join(',');
  const rows=(await env.DB.prepare(
    'SELECT DISTINCT sc.store_id FROM delivery_store_catalogue sc '+
    'JOIN products p ON p.id=sc.product_id JOIN categories c ON c.id=p.category_id '+
    'LEFT JOIN delivery_store_inventory i ON i.store_id=sc.store_id AND i.product_id=sc.product_id '+
    'WHERE sc.store_id IN ('+placeholders+') AND sc.is_available=1 AND p.active=1 AND c.active=1 '+
    'AND (p.stock_managed<>1 OR COALESCE(i.stock_quantity,0)-COALESCE((SELECT SUM(r.qty) '+
    "FROM delivery_store_inventory_reservations r WHERE r.store_id=sc.store_id AND r.product_id=sc.product_id "+
    "AND r.status IN ('reserved','conflict')),0)>0)"
  ).bind(...stores).all()).results||[];
  return new Set(rows.map(row=>String(row.store_id)));
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
  const rows = await slotRows(env, dateFrom, dateTo);
  const candidates=[];
  for (const slot of rows) {
    if (slot.delivery_date !== dateFrom || !slotCanBeCustomerBooked(slot, settings, now)) continue;
    const distance = distanceFor(payload.address || {}, slot);
    if (distance === Infinity || Number(slot.occupied) >= Number(slot.capacity)) continue;
    candidates.push({ ...slot, distance_km: distance });
  }
  const fulfilment=await storeFulfilmentMap(env,candidates.map(slot=>slot.store_id),items,excludeOrderId);
  const eligible=candidates.filter(slot=>storeCanFulfil(slot.store_id,items,fulfilment));
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
async function resolveStoreForAddress(env, address = {}) {
  const stores = (await env.DB.prepare(
    'SELECT id,name,latitude,longitude,service_radius_km FROM delivery_stores WHERE is_active=1'
  ).all()).results || [];
  if (!stores.length) return { available:false, code:'NO_ACTIVE_STORE', message:'We are not taking delivery orders in your area right now.' };
  if (!hasCoordinates(address)) return { available:false, code:'LOCATION_REQUIRED', message:'Please confirm your delivery location on the map to see products available near you.' };
  const nearby = stores.map(store => ({...store,distance_km:distanceFor(address,store)}))
    .filter(store => store.distance_km !== Infinity)
    .sort((a,b) => a.distance_km-b.distance_km || String(a.name).localeCompare(String(b.name)));
  if (!nearby.length) return { available:false, code:'AREA_UNAVAILABLE', message:'Sorry, we do not deliver to this address yet.' };
  const availableStoreIds=await storesWithAvailableProducts(env,nearby.map(store=>store.id));
  for (const store of nearby) {
    if (availableStoreIds.has(String(store.id))) {
      return { available:true, code:'AVAILABLE', message:'FreshWay delivers to your area from ' + store.name + '.', store:{id:store.id,name:store.name,distanceKm:Math.round(store.distance_km*10)/10} };
    }
  }
  return {available:false,code:'NO_STORE_CATALOGUE',message:'There are no products available for delivery in your area right now.'};
}

async function resolveStoreAvailability(env,payload={}) {
  const items=await cleanItems(env,payload.items);
  if(!items.length)return {available:false,code:'EMPTY_BASKET',message:'Add products to your cart to check delivery availability.'};
  const stores=(await env.DB.prepare('SELECT id,name,latitude,longitude,service_radius_km FROM delivery_stores WHERE is_active=1').all()).results||[];
  if(!stores.length)return {available:false,code:'NO_ACTIVE_STORE',message:'We are not taking delivery orders in your area right now.'};
  if(!hasCoordinates(payload.address||{}))return {available:false,code:'LOCATION_REQUIRED',message:'Please confirm your delivery location on the map to check delivery.'};
  let nearby=stores.map(store=>({...store,distance_km:distanceFor(payload.address||{},store)})).filter(s=>s.distance_km!==Infinity);
  if(!nearby.length)return {available:false,code:'AREA_UNAVAILABLE',message:'Sorry, we do not deliver to this address yet.'};
  if(payload.storeId){
    nearby=nearby.filter(store=>String(store.id)===String(payload.storeId));
    if(!nearby.length)return {available:false,code:'STORE_CHANGED',message:'Your selected delivery store is no longer available for this address. Refresh the catalogue and review your cart.'};
  }
  nearby.sort((a,b)=>a.distance_km-b.distance_km||String(a.name).localeCompare(String(b.name)));
  const fulfilment=await storeFulfilmentMap(env,nearby.map(store=>store.id),items);
  const selected=nearby.find(candidate=>storeCanFulfil(candidate.id,items,fulfilment))||null;
  if(!selected)return {available:false,code:'OUT_OF_STOCK',message:payload.storeId?'The selected store can no longer fulfil every item in your basket. Review your cart or refresh the delivery location.':'Some items in your basket are not available from nearby stores. Please adjust your cart or try again.'};
  return {available:true,code:'AVAILABLE',message:'Good news! We deliver to your area from '+selected.name+'.',store:{id:selected.id,name:selected.name,distanceKm:Math.round(selected.distance_km*10)/10}};
}
export async function prepareCheckoutDelivery(env,payload,items) {
  const raw=clean(payload.preferredDeliveryDate||payload.deliveryDate||payload.scheduledDeliveryDate);
  if(!raw)throw new Error('Choose a preferred delivery date before placing your order.');
  if(!dateValid(raw))throw new Error('Choose a valid preferred delivery date.');
  const now=istNowParts();
  if(raw<now.date||raw>addDays(now.date,60))throw new Error('Choose a delivery date between today and the next 60 days.');
  const availability=await resolveStoreAvailability(env,{address:payload.address||{},items,storeId:payload.storeId||''});
  if(!availability.available)throw new Error(availability.message);
  return {date:raw,deliveryPlan:raw===now.date?'Today':raw===addDays(now.date,1)?'Tomorrow':'Later',status:'requested',storeId:availability.store.id,storeName:availability.store.name,distanceKm:availability.store.distanceKm};
}
export function checkoutDeliveryStatements(env,orderId,delivery,items) {
  if(!delivery)return [];
  const statements=[];
  if(delivery.storeId)for(const item of items.filter(itemNeedsStock)){
    const qty=Number(item.stockReservedQty??item.stock_reserved_qty??0);
    if(!Number.isSafeInteger(qty)||qty<1)continue;
    statements.push(env.DB.prepare("INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason) VALUES (?,?,?,?,?,'reserved',0,'')").bind(id('stockres'),orderId,delivery.storeId,item.id??item.product_id,qty));
    statements.push(env.DB.prepare("UPDATE products SET stock_quantity=MAX(0,(SELECT COALESCE(SUM(i.stock_quantity),0) FROM delivery_store_inventory i JOIN delivery_stores s ON s.id=i.store_id AND s.is_active=1 WHERE i.product_id=?)-(SELECT COALESCE(SUM(r.qty),0) FROM delivery_store_inventory_reservations r JOIN delivery_stores s ON s.id=r.store_id AND s.is_active=1 WHERE r.product_id=? AND r.status IN ('reserved','conflict'))),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id??item.product_id,item.id??item.product_id,item.id??item.product_id));
  }
  statements.push(env.DB.prepare("INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,'system','checkout','delivery_date_requested','',NULL,?)").bind(id('audit'),orderId,enc({date:delivery.date,storeId:delivery.storeId,storeName:delivery.storeName,status:'requested'})));
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
function canCustomerCancelImmediately(order) {
  // New/Confirmed orders have not entered fulfilment. Let customers cancel them
  // directly even close to the delivery-slot cutoff instead of leaving them active
  // behind an Owner-review request. Later stages still go through Owner review.
  return ['new', 'confirmed'].includes(String(order?.delivery_status || '').trim().toLowerCase());
}
async function resolvePendingCancellationRequests(env, orderId, note) {
  try {
    await env.DB.prepare(
      "UPDATE order_action_requests SET status='rejected',resolution_note=?,resolved_by='customer',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND request_type='cancellation' AND status='pending'"
    ).bind(note, orderId).run();
  } catch (error) {
    // The cancellation is already durable before this cleanup; don't turn it
    // into a reported failure if an obsolete request could not be retired.
    console.error('FreshWay obsolete cancellation request cleanup failed:', error?.message || error);
  }
}
async function queueRequest(env, order, customerId, requestType, body = {}) {
  const existing = await env.DB.prepare("SELECT id,status,request_type,requested_slot_id,requested_delivery_date,reason FROM order_action_requests WHERE order_id=? AND request_type=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(order.id, requestType).first();
  if (existing) return { requestId: existing.id, status: existing.status, requestType: existing.request_type, alreadyRequested: true };
  const requestId = id('request'), reason = clean(body.reason).slice(0, 500), requestedSlotId = clean(body.slotId || body.requestedSlotId) || null;
  const requestedDate = requestType === 'reschedule' ? clean(body.requestedDeliveryDate) : null;
  if (requestType === 'reschedule' && (!dateValid(requestedDate) || requestedDate < istNowParts().date || requestedDate > addDays(istNowParts().date, 60))) throw new Error('Choose a valid delivery date between today and the next 60 days.');
  const statements = [
    env.DB.prepare("INSERT INTO order_action_requests (id,order_id,customer_id,request_type,requested_slot_id,requested_delivery_date,reason,status) VALUES (?,?,?,?,?,?,?,'pending')").bind(requestId, order.id, customerId, requestType, requestedSlotId, requestedDate, reason),
    env.DB.prepare("INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,'customer',?,?,?,?,?)").bind(id('audit'), order.id, customerId, requestType + '_requested', reason, enc(order), enc({ requestId, requestType, requestedSlotId, requestedDeliveryDate: requestedDate, status: 'pending' }))
  ];
  try { await env.DB.batch(statements); }
  catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) {
      const latest = await env.DB.prepare("SELECT id,status,request_type FROM order_action_requests WHERE order_id=? AND request_type=? AND status='pending' LIMIT 1").bind(order.id, requestType).first();
      if (latest) return { requestId: latest.id, status: latest.status, requestType: latest.request_type, alreadyRequested: true };
    }
    throw error;
  }
  return { requestId, status: 'pending', requestType, message: 'Your request was sent to FreshWay. The current delivery date remains in place until the Owner changes it.' };
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
  let candidates = [];
  if (selected) {
    const rows = await slotRows(env, targetDate, targetDate);
    const activeStores = Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count || 0);
    const stock = await inventoryMap(env, order.id);
    const lines = (await env.DB.prepare('SELECT oi.product_id id,oi.qty,oi.stock_reserved_qty stockReservedQty,p.stock_managed FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?').bind(order.id).all()).results || [];
    // An Owner selecting a configured slot expects that exact store/window. An override
    // may bypass capacity/availability guards, but must never silently switch stores.
    candidates = rows.filter(slot => slot.id === selected.id)
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
  const newStoreId = chosen?.store_id || target.store_id || order.assigned_store_id || null;
  const newSlotId = chosen?.id || null;
  const oldStore = order.assigned_store_id || null;
  const changingStore = !!(newStoreId && newStoreId !== oldStore);
  if (changingStore) {
    const address = await env.DB.prepare('SELECT a.latitude,a.longitude FROM orders o JOIN addresses a ON a.id=o.address_id WHERE o.id=?').bind(order.id).first();
    const store = chosen || await env.DB.prepare('SELECT id,latitude,longitude,service_radius_km,is_active FROM delivery_stores WHERE id=?').bind(newStoreId).first();
    const storeIsActive = chosen ? Number(chosen.store_active) === 1 : Number(store?.is_active) === 1;
    if (!store || !storeIsActive) throw new Error('Choose an active store. Inactive stores cannot receive new orders.');
    if (!hasCoordinates(address || {}) || distanceFor(address, store) === Infinity) throw new Error('This store does not cover the customer delivery location.');
  }
  if (owner && override && !reason) throw new Error('Enter a reason for the Owner override.');
  if (owner && slotConflict && !override) throw new Error('This delivery window has a capacity, availability, date, or inventory conflict. Enable Owner override and add a reason to continue.');
  const status = currentStatus === 'Delivered' ? 'completed' :
    currentStatus === 'Cancelled' ? 'conflict' :
    slotConflict && owner && override ? 'conflict' : 'reserved';
  if (status === 'reserved' && !chosen) throw new Error('Choose an available delivery window.');
  const lines = (await env.DB.prepare('SELECT oi.product_id id,oi.qty,oi.stock_reserved_qty stockReservedQty,p.stock_managed FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?').bind(order.id).all()).results || [];
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
        statements.push(env.DB.prepare('UPDATE order_items SET stock_reserved_qty=qty WHERE order_id=? AND product_id=?').bind(order.id,line.id));
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
    const type = stockConflict ? 'store_stock_shortfall' : (!selected && owner ? 'manual_schedule_without_slot' : slotConflict ? 'slot_overbooked_or_inactive' : 'delivery_unassigned');
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
    if (/DELIVERY_STORE_INACTIVE/i.test(String(error?.message || ''))) throw new Error('ORDER_CONFLICT: The selected store is inactive. Choose an active store.');
    if (/DELIVERY_STORE_STOCK_LOW/i.test(String(error?.message || ''))) throw new Error('ORDER_CONFLICT: That store no longer has enough stock for this order.');
    throw error;
  }
  if(changingStore)await refreshProductAvailability(env);
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
  if (action === 'cancel') {
    const currentStatus = String(order.delivery_status || '').trim().toLowerCase();
    if (currentStatus === 'cancelled') {
      await resolvePendingCancellationRequests(env, order.id, 'Order was already cancelled.');
      return response({ ok: true, status: 'Cancelled', alreadyCancelled: true });
    }
    if (currentStatus === 'delivered') return response({ error: 'Delivered orders cannot be cancelled here. Submit an issue or return request instead.' }, 409);
    if (!canCustomerCancelImmediately(order)) {
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
    await resolvePendingCancellationRequests(env, order.id, 'Order was cancelled directly by the customer.');
    const after = await env.DB.prepare('SELECT customer_id,delivery_status,payment_status,delivery_plan,is_test_order FROM orders WHERE id=?').bind(order.id).first();
    await notifyCustomerAndOwner(env, order.id, before, 'order_cancelled_by_customer', 'Your order has been cancelled.', after);
    return response({ ok: true, status: changed.status, message: 'Your order has been cancelled.' });
  }
  if (action === 'reschedule') {
    const requestedDeliveryDate = clean(body.requestedDeliveryDate);
    if (order.delivery_status === 'Delivered' || order.delivery_status === 'Cancelled') return response({ error: 'This order cannot be rescheduled in its current status.' }, 409);
    if (!dateValid(requestedDeliveryDate) || requestedDeliveryDate < istNowParts().date || requestedDeliveryDate > addDays(istNowParts().date, 60)) return response({ error: 'Choose a valid delivery date between today and the next 60 days.' }, 400);
    const plan = requestedDeliveryDate === istNowParts().date ? 'Today' : requestedDeliveryDate === addDays(istNowParts().date, 1) ? 'Tomorrow' : 'Later';
    const before = { ...order };
    const dateStatements = [];
    if (order.scheduled_slot_id) {
      // Changing only the date releases the old slot, not the store's basket-stock reservation.
      dateStatements.push(env.DB.prepare("UPDATE delivery_slot_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(order.id));
    }
    dateStatements.push(env.DB.prepare("UPDATE orders SET scheduled_delivery_date=?,scheduled_slot_id=NULL,scheduled_start_minute=NULL,scheduled_end_minute=NULL,schedule_status='confirmed',delivery_plan=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND delivery_status NOT IN ('Delivered','Cancelled')").bind(requestedDeliveryDate, plan, order.id));
    await env.DB.batch(dateStatements);
    const updated = await getOrderForAction(env, order.id);
    if (!updated || updated.scheduled_delivery_date !== requestedDeliveryDate) throw new Error('Delivery date could not be saved. Refresh and try again.');
    await writeAudit(env, order.id, 'customer', customerId, 'delivery_date_changed_by_customer', '', before, { date: requestedDeliveryDate, delivery_plan: plan });
    await notifyCustomerAndOwner(env, order.id, { customer_id: order.customer_id, delivery_status: order.delivery_status, payment_status: order.payment_status, delivery_plan: order.delivery_plan, is_test_order: order.is_test_order }, 'delivery_date_changed', 'Your delivery date is now ' + requestedDeliveryDate + '.');
    return response({ ok: true, status: 'updated', scheduledDelivery: { date: requestedDeliveryDate }, message: 'Delivery date updated.' });
  }
  if (action === 'request') {
    const requestType = clean(body.requestType);
    if (!['cancellation','return','issue'].includes(requestType)) {
      if (requestType === 'reschedule') {
        return response({ error: 'Delivery dates update directly. Use Change delivery date on My Orders; no approval request is needed.' }, 409);
      }
      return response({ error: 'Choose a valid order request type.' }, 400);
    }
    if (requestType === 'return' && order.delivery_status !== 'Delivered') return response({ error: 'Return requests are available after delivery. For an active order, request cancellation.' }, 409);
    const queued = await queueRequest(env, order, customerId, requestType, body);
    return response({ ok: true, request: queued }, 202);
  }
  return response({ error: 'Unsupported order action.' }, 404);
}

export async function handleCustomerDeliveryRequest(request, env, customerId) {
  const url = new URL(request.url);
  if(url.pathname==='/api/delivery/store'&&request.method==='POST'){
    let body={};try{body=await request.json();}catch(_){}
    try{return response(await resolveStoreForAddress(env,body.address||{}));}
    catch(error){
      if(deliverySchemaMissing(error))return response({available:false,code:'DELIVERY_SCHEMA_UNAVAILABLE',message:'Store availability is temporarily unavailable. Please try again later.'},503);
      return response({available:false,code:'DELIVERY_AVAILABILITY_ERROR',message:'We could not find a store for this address. Please try again.'},503);
    }
  }
  if(url.pathname==='/api/delivery/availability'&&request.method==='POST'){
    let body={};try{body=await request.json();}catch(_){}
    try{return response(await resolveStoreAvailability(env,body));}
    catch(error){
      if(deliverySchemaMissing(error)){console.error('FreshWay delivery availability schema is missing:',error?.message||error);return response({available:false,code:'DELIVERY_SCHEMA_UNAVAILABLE',message:'Delivery availability is temporarily unavailable. Please try again later.'},503);}
      console.error('FreshWay store availability check failed:',error?.message||error);
      return response({available:false,code:'DELIVERY_AVAILABILITY_ERROR',message:'We could not check delivery availability. Please try again.'},503);
    }
  }
  if (url.pathname === '/api/delivery/slots' && request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    try { return response(await resolveAvailableSlots(env, body, clean(body.date))); }
    catch (error) {
      if (deliverySchemaMissing(error)) {
        console.error('FreshWay delivery availability is unavailable because a required database schema table is missing:', error?.message || error);
        return response({ error: 'Delivery availability is temporarily unavailable in this environment. Please try again later.', code: 'DELIVERY_SCHEMA_UNAVAILABLE' }, 503);
      }
      return response({ error: error.message || 'Could not load available delivery windows.' }, 400);
    }
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

async function refreshProductAvailability(env) {
  const rows=(await env.DB.prepare('SELECT id FROM products WHERE stock_managed=1').all()).results||[];
  const statements=rows.map(row=>env.DB.prepare("UPDATE products SET stock_quantity=MAX(0,(SELECT COALESCE(SUM(i.stock_quantity),0) FROM delivery_store_inventory i JOIN delivery_stores s ON s.id=i.store_id AND s.is_active=1 WHERE i.product_id=?)-(SELECT COALESCE(SUM(r.qty),0) FROM delivery_store_inventory_reservations r JOIN delivery_stores s ON s.id=r.store_id AND s.is_active=1 WHERE r.product_id=? AND r.status IN ('reserved','conflict'))),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id,row.id,row.id));
  if(statements.length)await env.DB.batch(statements);
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

async function getUnassignedOrderReconciliation(env) {
  const today = istNowParts().date;
  const rows = (await env.DB.prepare(
    "SELECT o.id,o.delivery_status,o.payment_status,o.delivery_plan,o.scheduled_delivery_date,o.created_at,o.total," +
    "o.assigned_store_id,ds.name assigned_store_name,COALESCE(s.latitude,a.latitude) latitude," +
    "COALESCE(s.longitude,a.longitude) longitude " +
    "FROM orders o LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id " +
    "LEFT JOIN addresses a ON a.id=o.address_id LEFT JOIN order_address_snapshots s ON s.order_id=o.id " +
    "WHERE o.is_test_order=0 AND o.delivery_status NOT IN ('Delivered','Cancelled') " +
    "AND (o.assigned_store_id IS NULL OR ds.id IS NULL OR ds.is_active<>1) " +
    "ORDER BY CASE WHEN o.delivery_status='Out for Delivery' THEN 0 ELSE 1 END," +
    "o.created_at ASC,o.id"
  ).all()).results || [];
  if (!rows.length) return [];

  const orderIds = rows.map(row => String(row.id));
  const orderSlots = orderIds.map(() => '?').join(',');
  const itemRows = (await env.DB.prepare(
    'SELECT oi.order_id,oi.product_id id,oi.name,oi.qty,p.stock_managed ' +
    'FROM order_items oi JOIN products p ON p.id=oi.product_id ' +
    'WHERE oi.order_id IN (' + orderSlots + ') ORDER BY oi.order_id,oi.id'
  ).bind(...orderIds).all()).results || [];
  const itemsByOrder = new Map(orderIds.map(id => [id, []]));
  for (const item of itemRows) {
    itemsByOrder.get(String(item.order_id))?.push({
      id: String(item.id), name: String(item.name || item.id),
      qty: Number(item.qty || 0), stock_managed: Number(item.stock_managed || 0)
    });
  }

  const stores = (await env.DB.prepare(
    'SELECT id,name,latitude,longitude,service_radius_km FROM delivery_stores WHERE is_active=1 ORDER BY name,id'
  ).all()).results || [];
  const allItems = [...itemsByOrder.values()].flat();
  const fulfilment = await storeFulfilmentMap(env, stores.map(store => store.id), allItems);
  const nowMs = Date.now();

  return rows.map(order => {
    const items = itemsByOrder.get(String(order.id)) || [];
    const address = { latitude: order.latitude, longitude: order.longitude };
    const locationAvailable = hasCoordinates(address);
    const nearby = locationAvailable
      ? stores.map(store => ({ ...store, distance_km: distanceFor(address, store) }))
        .filter(store => store.distance_km !== Infinity)
        .sort((a, b) => a.distance_km - b.distance_km || String(a.name).localeCompare(String(b.name)))
      : [];
    const assessments = nearby.map(store => {
      const storeProducts = fulfilment.get(String(store.id));
      const blockers = [];
      for (const item of items) {
        const product = storeProducts?.get(item.id);
        if (!product) {
          blockers.push({ product: item.name, reason: 'missing-store-catalogue' });
        } else if (Number(product.active) !== 1 || Number(product.category_active) !== 1) {
          blockers.push({ product: item.name, reason: 'centrally-inactive' });
        } else if (Number(product.is_available) !== 1) {
          blockers.push({ product: item.name, reason: 'disabled-at-store' });
        } else if (Number(product.stock_managed) === 1) {
          const available = Math.max(0, Number(product.on_hand || 0) - Number(product.reserved_qty || 0));
          if (available < item.qty) blockers.push({
            product: item.name, reason: 'insufficient-stock', available, requested: item.qty
          });
        }
      }
      return {
        id: String(store.id), name: String(store.name),
        distanceKm: Math.round(Number(store.distance_km) * 10) / 10,
        canFulfilWholeBasket: blockers.length === 0,
        blockers
      };
    });
    const eligibleStores = assessments.filter(store => store.canFulfilWholeBasket);
    const createdAt = String(order.created_at || '');
    const createdMs = Date.parse(createdAt);
    const ageDays = Number.isFinite(createdMs)
      ? Math.max(0, Math.floor((nowMs - createdMs) / 86400000))
      : null;
    const scheduledDateExpired = !!order.scheduled_delivery_date && order.scheduled_delivery_date < today;
    const status = String(order.delivery_status || '');
    const payment = String(order.payment_status || '');
    const urgentDeliveryVerification = status === 'Out for Delivery' && payment === 'Collected';
    let diagnosis = 'eligible-store-found';
    if (urgentDeliveryVerification) diagnosis = 'verify-delivery-before-any-assignment';
    else if (!locationAvailable) diagnosis = 'missing-delivery-location';
    else if (!items.length) diagnosis = 'missing-order-items';
    else if (!nearby.length) diagnosis = 'no-active-store-within-radius';
    else if (!eligibleStores.length) diagnosis = 'no-single-store-can-fulfil-whole-basket';
    else if (scheduledDateExpired) diagnosis = 'eligible-store-found-date-needs-confirmation';

    return {
      orderId: String(order.id),
      deliveryStatus: status,
      paymentStatus: payment,
      deliveryPlan: String(order.delivery_plan || ''),
      scheduledDeliveryDate: order.scheduled_delivery_date || null,
      scheduledDateExpired,
      createdAt,
      ageDays,
      total: Number(order.total || 0),
      assignedStoreId: order.assigned_store_id || null,
      assignedStoreName: order.assigned_store_name || null,
      locationAvailable,
      itemCount: items.length,
      items: items.map(item => ({
        productId: item.id, name: item.name, quantity: item.qty,
        stockManaged: item.stock_managed === 1
      })),
      nearestStores: assessments,
      eligibleStores,
      urgentDeliveryVerification,
      diagnosis
    };
  });
}
export async function handleAdminDeliveryRequest(request, env) {
  const url = new URL(request.url), path = url.pathname;

  if (path === '/api/admin/delivery/reconciliation' && request.method === 'GET') {
    return response({ orders: await getUnassignedOrderReconciliation(env) });
  }

  const reconcilePrefix = '/api/admin/delivery/orders/';
  const reconcileSuffix = '/reconcile';
  if (path.startsWith(reconcilePrefix) && path.endsWith(reconcileSuffix) && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const orderId = decodeURIComponent(path.slice(reconcilePrefix.length, -reconcileSuffix.length));
    const order = await getOrderForAction(env, orderId);
    if (!order) throw new Error('Order not found.');
    if (Number(order.is_test_order) === 1) throw new Error('Test orders cannot be reconciled as customer orders.');
    if (!['new','confirmed'].includes(String(order.delivery_status || '').trim().toLowerCase())) {
      throw new Error('This order has entered fulfilment. Verify delivery with the customer before changing its store.');
    }
    if (order.assigned_store_id) {
      const currentStore = await env.DB.prepare('SELECT id,is_active FROM delivery_stores WHERE id=?').bind(order.assigned_store_id).first();
      if (currentStore && Number(currentStore.is_active) === 1) {
        throw new Error('This order already has an active fulfilment store. Use the normal reassignment workflow instead.');
      }
    }
    if (body.customerConfirmed !== true) {
      throw new Error('Confirm that the customer has reconfirmed the delivery location and new delivery date.');
    }
    const reason = clean(body.confirmationNote).slice(0,500);
    if (reason.length < 12) throw new Error('Enter a meaningful customer-confirmation note for the audit trail.');
    const deliveryDate = clean(body.deliveryDate);
    const now = istNowParts();
    if (!dateValid(deliveryDate) || deliveryDate < now.date || deliveryDate > addDays(now.date,60)) {
      throw new Error('Choose a delivery date between today and the next 60 days.');
    }
    const storeId = clean(body.storeId);
    if (!storeId) throw new Error('Choose one of the eligible stores.');
    const store = await env.DB.prepare(
      'SELECT id,name,latitude,longitude,service_radius_km,is_active FROM delivery_stores WHERE id=?'
    ).bind(storeId).first();
    if (!store || Number(store.is_active) !== 1) throw new Error('Choose an active store.');

    const orderAddress = await env.DB.prepare(
      'SELECT COALESCE(s.latitude,a.latitude) latitude,COALESCE(s.longitude,a.longitude) longitude ' +
      'FROM orders o LEFT JOIN addresses a ON a.id=o.address_id ' +
      'LEFT JOIN order_address_snapshots s ON s.order_id=o.id WHERE o.id=?'
    ).bind(orderId).first();
    if (!hasCoordinates(orderAddress || {}) || distanceFor(orderAddress,store) === Infinity) {
      throw new Error('This store does not cover the customer delivery location. Confirm the location first.');
    }

    const lines = (await env.DB.prepare(
      'SELECT oi.product_id id,oi.qty,oi.name,p.stock_managed ' +
      'FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?'
    ).bind(orderId).all()).results || [];
    if (!lines.length) throw new Error('This order has no items to reconcile.');
    const fulfilment = await storeFulfilmentMap(env,[storeId],lines,orderId);
    if (!storeCanFulfil(storeId,lines,fulfilment)) {
      throw new Error('This store cannot fulfil the complete basket from its current catalogue and available stock.');
    }
    if (!inventoryFits(storeId,lines,await inventoryMap(env,orderId))) {
      throw new Error('Store stock changed. Refresh the reconciliation queue and try again.');
    }

    const plan = deliveryDate === now.date ? 'Today' :
      deliveryDate === addDays(now.date,1) ? 'Tomorrow' : 'Later';
    const statements = [
      env.DB.prepare("UPDATE delivery_store_inventory_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(orderId),
      env.DB.prepare("UPDATE delivery_slot_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(orderId),
      env.DB.prepare(
        "UPDATE orders SET assigned_store_id=?,scheduled_delivery_date=?,scheduled_slot_id=NULL," +
        "scheduled_start_minute=NULL,scheduled_end_minute=NULL,schedule_status='confirmed'," +
        "delivery_plan=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(storeId,deliveryDate,plan,orderId)
    ];
    for (const line of lines) {
      const managed = itemNeedsStock(line);
      statements.push(env.DB.prepare(
        'UPDATE order_items SET stock_reserved_qty=? WHERE order_id=? AND product_id=?'
      ).bind(managed ? Number(line.qty) : 0,orderId,line.id));
      if (managed) {
        statements.push(env.DB.prepare(
          "INSERT INTO delivery_store_inventory_reservations " +
          "(id,order_id,store_id,product_id,qty,status,owner_override,override_reason) " +
          "VALUES (?,?,?,?,?,'reserved',0,'')"
        ).bind(id('stockres'),orderId,storeId,line.id,Number(line.qty)));
      }
    }
    statements.push(env.DB.prepare(
      "INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) " +
      "VALUES (?,?,'owner',?,?,?,?,?)"
    ).bind(id('audit'),orderId,clean(request.headers.get('X-Freshway-Owner-Id'))||'owner',
      'unassigned_order_reconciled',reason,enc(order),enc({
        storeId,storeName:store.name,deliveryDate,deliveryPlan:plan,
        customerConfirmed:true
      })));
    try { await env.DB.batch(statements); }
    catch (error) {
      if (/DELIVERY_STORE_INACTIVE/i.test(String(error?.message||''))) {
        throw new Error('Store availability changed. Refresh the reconciliation queue and try again.');
      }
      if (/DELIVERY_STORE_STOCK_LOW/i.test(String(error?.message||''))) {
        throw new Error('Store stock changed. Refresh the reconciliation queue and try again.');
      }
      throw error;
    }
    await refreshProductAvailability(env);
    const updated = await getOrderForAction(env,orderId);
    await notifyCustomerAndOwner(env,orderId,{
      customer_id:order.customer_id,delivery_status:order.delivery_status,
      payment_status:order.payment_status,delivery_plan:order.delivery_plan,
      is_test_order:order.is_test_order
    },'unassigned_order_reconciled',
    'Your delivery has been reconfirmed for '+deliveryDate+' from '+store.name+'.',{
      customer_id:order.customer_id,delivery_status:updated?.delivery_status,
      payment_status:updated?.payment_status,delivery_plan:updated?.delivery_plan,
      is_test_order:order.is_test_order
    });
    return response({
      ok:true,orderId,store:{id:store.id,name:store.name},
      scheduledDelivery:{date:deliveryDate},reservationsRebuilt:true
    });
  }
  if (path === '/api/admin/delivery' && request.method === 'GET') {
    const orders=(await env.DB.prepare("SELECT o.id,o.customer_name,o.customer_phone,o.delivery_status,o.scheduled_delivery_date,o.delivery_plan,o.created_at,o.total,o.assigned_store_id,ds.name assigned_store_name,ds.is_active assigned_store_active FROM orders o LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id WHERE o.delivery_status NOT IN ('Delivered','Cancelled') ORDER BY CASE WHEN o.scheduled_delivery_date IS NULL THEN 1 ELSE 0 END,o.scheduled_delivery_date,o.created_at DESC LIMIT 300").all()).results||[];
    const requests=(await env.DB.prepare("SELECT r.id,r.order_id,r.customer_id,r.request_type,r.requested_delivery_date,r.reason,r.status,r.created_at,o.delivery_status,o.total,o.scheduled_delivery_date,o.customer_name,c.phone customer_phone FROM order_action_requests r JOIN orders o ON o.id=r.order_id LEFT JOIN customers c ON c.id=r.customer_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 200").all()).results||[];
    const stores=(await env.DB.prepare('SELECT id,name,is_active FROM delivery_stores ORDER BY name,id').all()).results||[];
    return response({ok:true,orders,requests,settings:{enabled:1},stores,products:[],inventory:[],slots:[],operationalFlags:[]});
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
  if (path === '/api/admin/delivery/stores' && request.method === 'GET') {
    const stores=(await env.DB.prepare("SELECT d.id,d.name,d.address,d.latitude,d.longitude,d.service_radius_km,d.is_active,d.created_at,d.updated_at,(SELECT COUNT(*) FROM orders o WHERE o.assigned_store_id=d.id AND o.delivery_status NOT IN ('Delivered','Cancelled')) pending_order_count FROM delivery_stores d ORDER BY d.created_at,d.id").all()).results||[];
    return response({stores});
  }
  if (path === '/api/admin/delivery/stores' && request.method === 'POST') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const name = clean(body.name).slice(0, 120), address = clean(body.address).slice(0, 300);
    const latitude = Number(body.latitude), longitude = Number(body.longitude), radius = Number(body.serviceRadiusKm ?? 5);
    if (!name) throw new Error('Enter the store name.');
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Enter valid store map coordinates.');
    if (!Number.isFinite(radius) || radius < 0.1 || radius > 100) throw new Error('Invalid store delivery radius.');
    const storeId=id('store');
    const existingStores=Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores').first())?.count||0);
    const inventorySeed=existingStores===0?'copied-current-available-stock':'zero-stock-requires-setup';
    const statements=[
      env.DB.prepare('INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active) VALUES (?,?,?,?,?,?,0)').bind(storeId,name,address,latitude,longitude,radius),
      env.DB.prepare(existingStores===0?'INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT ?,id,stock_quantity FROM products WHERE stock_managed=1':'INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT ?,id,0 FROM products WHERE stock_managed=1').bind(storeId),
      env.DB.prepare('INSERT INTO delivery_store_catalogue (store_id,product_id,is_available,price_override) SELECT ?,id,1,NULL FROM products').bind(storeId)
    ];
    await env.DB.batch(statements);
    await refreshProductAvailability(env);
    return response({ok:true,store:{id:storeId,name,address,latitude,longitude,service_radius_km:radius,is_active:0},initialInventory:inventorySeed},201);
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
    await refreshProductAvailability(env);
    const pendingOrderCount=Number((await env.DB.prepare("SELECT COUNT(*) count FROM orders WHERE assigned_store_id=? AND delivery_status NOT IN ('Delivered','Cancelled')").bind(storeId).first())?.count||0);
    return response({ok:true,store:{...current,name,address,latitude,longitude,service_radius_km:radius,is_active:active,pending_order_count:pendingOrderCount},pendingOrderCount});
  }
  const catalogueMatch = path.match(new RegExp('^/api/admin/delivery/stores/([^/]+)/catalogue$'));
  if (catalogueMatch && request.method === 'GET') {
    const storeId = decodeURIComponent(catalogueMatch[1]);
    const items = await getStoreCatalogueRows(env, storeId);
    return response({items:items.map(row=>({
      id:row.id,name:row.name,unit:row.unit,centralPrice:Number(row.central_price),
      priceOverride:row.price_override==null?null:Number(row.price_override),
      storePrice:Number(row.effective_price),isAvailable:Number(row.is_available)===1,
      stockManaged:Number(row.stock_managed)===1,onHand:Number(row.on_hand||0),reservedQty:Number(row.reserved_qty||0),
      categoryName:row.category_name||''
    }))});
  }
  if (catalogueMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const storeId = decodeURIComponent(catalogueMatch[1]);
    const items = await saveStoreCatalogue(env, storeId, body.items);
    return response({ok:true,items:items.map(row=>({
      id:row.id,name:row.name,unit:row.unit,centralPrice:Number(row.central_price),
      priceOverride:row.price_override==null?null:Number(row.price_override),
      storePrice:Number(row.effective_price),isAvailable:Number(row.is_available)===1,
      stockManaged:Number(row.stock_managed)===1,onHand:Number(row.on_hand||0),reservedQty:Number(row.reserved_qty||0),
      categoryName:row.category_name||''
    }))});
  }
  const inventoryMatch = path.match(new RegExp('^/api/admin/delivery/stores/([^/]+)/inventory$'));
  if (inventoryMatch && request.method === 'GET') {
    const storeId = decodeURIComponent(inventoryMatch[1]);
    const store = await env.DB.prepare('SELECT * FROM delivery_stores WHERE id=?').bind(storeId).first();
    if (!store) throw new Error('Delivery store not found.');
    await ensureStoreInventoryRows(env);
    return response({ store, inventory: await inventoryAvailabilityForStore(env, storeId) });
  }
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
        'UPDATE products SET stock_quantity=MAX(0,(SELECT COALESCE(SUM(i.stock_quantity),0) FROM delivery_store_inventory i JOIN delivery_stores s ON s.id=i.store_id AND s.is_active=1 WHERE i.product_id=?)-' +
        '(SELECT COALESCE(SUM(r.qty),0) FROM delivery_store_inventory_reservations r JOIN delivery_stores s ON s.id=r.store_id AND s.is_active=1 WHERE r.product_id=? AND r.status IN (\'reserved\',\'conflict\'))),updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).bind(row.id, row.id, row.id));
    }
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (/DELIVERY_STORE_STOCK_RESERVED/i.test(String(error?.message || ''))) {
        throw new Error('Stock on hand cannot be lower than active reservations. Refresh inventory and try again.');
      }
      throw error;
    }
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
  const storeAssignmentPrefix='/api/admin/delivery/orders/';
  if(path.startsWith(storeAssignmentPrefix)&&path.endsWith('/store')&&request.method==='PATCH'){
    let body={};try{body=await request.json();}catch(_){}
    const orderId=decodeURIComponent(path.slice(storeAssignmentPrefix.length,-6));
    const order=await getOrderForAction(env,orderId);
    if(!order)throw new Error('Order not found.');
    if(['delivered','cancelled'].includes(String(order.delivery_status||'').trim().toLowerCase()))throw new Error('A delivered or cancelled order cannot be reassigned.');
    const storeId=clean(body.storeId);
    if(!storeId)throw new Error('Choose an active store.');
    const store=await env.DB.prepare('SELECT id,name,latitude,longitude,service_radius_km,is_active FROM delivery_stores WHERE id=?').bind(storeId).first();
    if(!store)throw new Error('Choose an active store.');
    const sameStore=storeId===order.assigned_store_id;
    // Existing orders remain attached to a deactivated store. They cannot be
    // newly assigned or have stock re-reserved there until the store is active.
    if(Number(store.is_active)!==1){
      if(sameStore)return response({ok:true,unchanged:true,orderId,store:{id:store.id,name:store.name,is_active:store.is_active},warning:'This store is inactive. The existing order remains assigned and its reservations are preserved.'});
      throw new Error('Choose an active store. Inactive stores cannot receive new orders.');
    }
    if(!sameStore){
      const orderAddress=await env.DB.prepare('SELECT a.latitude,a.longitude FROM orders o JOIN addresses a ON a.id=o.address_id WHERE o.id=?').bind(orderId).first();
      if(!hasCoordinates(orderAddress||{})||distanceFor(orderAddress,store)===Infinity)throw new Error('This store does not cover the customer delivery location.');
    }
    await ensureStoreInventoryRows(env);
    const lines=(await env.DB.prepare('SELECT oi.product_id id,oi.qty,oi.stock_reserved_qty stockReservedQty,p.stock_managed FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?').bind(orderId).all()).results||[];
    if(!inventoryFits(storeId,lines,await inventoryMap(env,orderId)))throw new Error('This store cannot fulfil the complete order. Choose another active store with enough stock.');
    const before={...order};
    const statements=[];
    if(sameStore){
      // Re-confirming the current active store is also the Owner's recovery path
      // for reopened orders: replace conflict/missing reservations with a normal
      // reservation after checking this store's stock excluding the order itself.
      statements.push(env.DB.prepare("UPDATE delivery_store_inventory_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(orderId));
      for(const line of lines.filter(itemNeedsStock)){
        statements.push(env.DB.prepare("INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason) VALUES (?,?,?,?,?,'reserved',0,'')").bind(id('stockres'),orderId,storeId,line.id,Number(line.qty)));
        statements.push(env.DB.prepare('UPDATE order_items SET stock_reserved_qty=qty WHERE order_id=? AND product_id=?').bind(orderId,line.id));
      }
      const scheduleStatus=order.scheduled_slot_id?(order.schedule_status||'conflict'):(order.scheduled_delivery_date?'confirmed':'unscheduled');
      statements.push(env.DB.prepare('UPDATE orders SET schedule_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(scheduleStatus,orderId));
      statements.push(env.DB.prepare("UPDATE order_operational_flags SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND flag_type='reopen_stock_shortfall' AND status='open'").bind(orderId));
      if(!order.scheduled_slot_id)statements.push(env.DB.prepare("UPDATE order_operational_flags SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND flag_type='reopened_order_needs_schedule_confirmation' AND status='open'").bind(orderId));
    }else{
      const scheduleStatus=order.scheduled_delivery_date?'confirmed':'unscheduled';
      statements.push(env.DB.prepare("UPDATE orders SET assigned_store_id=?,scheduled_slot_id=NULL,scheduled_start_minute=NULL,scheduled_end_minute=NULL,schedule_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(storeId,scheduleStatus,orderId));
      statements.push(env.DB.prepare("UPDATE delivery_store_inventory_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(orderId));
      statements.push(env.DB.prepare("UPDATE delivery_slot_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(orderId));
      for(const line of lines.filter(itemNeedsStock)){
        statements.push(env.DB.prepare("INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason) VALUES (?,?,?,?,?,'reserved',0,'')").bind(id('stockres'),orderId,storeId,line.id,Number(line.qty)));
        statements.push(env.DB.prepare('UPDATE order_items SET stock_reserved_qty=qty WHERE order_id=? AND product_id=?').bind(orderId,line.id));
      }
    }
    const action=sameStore?'fulfilment_store_stock_reconfirmed':'fulfilment_store_reassigned';
    const reason=clean(body.reason).slice(0,500)||(sameStore?'Owner re-confirmed stock at the current fulfilment store':'Owner reassigned fulfilment store');
    statements.push(env.DB.prepare("INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,'owner',?,?,?,?,?)").bind(id('audit'),orderId,clean(request.headers.get('X-Freshway-Owner-Id'))||'owner',action,reason,enc(before),enc({storeId,storeName:store.name,reconfirmed:sameStore})));
    try{await env.DB.batch(statements);}catch(error){
      if(/DELIVERY_STORE_INACTIVE/i.test(String(error?.message||'')))throw new Error('Choose an active store. Store availability changed; refresh and try again.');
      if(/DELIVERY_ORDER_CLOSED/i.test(String(error?.message||'')))throw new Error('This order was completed or cancelled while you were updating its store. Refresh the order.');
      if(/DELIVERY_STORE_STOCK_LOW/i.test(String(error?.message||'')))throw new Error('Store stock changed. Refresh inventory and try again.');
      throw error;
    }
    await refreshProductAvailability(env);
    const updated=await getOrderForAction(env,orderId);
    await notifyCustomerAndOwner(env,orderId,{customer_id:order.customer_id,delivery_status:order.delivery_status,payment_status:order.payment_status,delivery_plan:order.delivery_plan,is_test_order:order.is_test_order},action,sameStore?'Stock reservation reconfirmed at '+store.name+'.':'Your order is now assigned to '+store.name+'.',{customer_id:order.customer_id,delivery_status:order.delivery_status,payment_status:order.payment_status,delivery_plan:updated?.delivery_plan,is_test_order:order.is_test_order});
    return response({ok:true,orderId,store:{id:store.id,name:store.name},reconfirmed:sameStore,scheduledDelivery:updated?.scheduled_delivery_date||null});
  }
  const scheduleMatch = path.match(new RegExp('^/api/admin/delivery/orders/([^/]+)/schedule$'));
  if (scheduleMatch && request.method === 'PATCH') {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const orderId = decodeURIComponent(scheduleMatch[1]);
    const order = await getOrderForAction(env, orderId);
    if (!order) throw new Error('Order not found.');
    if (['delivered', 'cancelled'].includes(String(order.delivery_status || '').trim().toLowerCase())) throw new Error('Delivery cannot be rescheduled for a delivered or cancelled order.');
    if (body.deliveryDate && !body.startTime && !body.endTime && !body.slotId) {
      if (!order) throw new Error('Order not found.');
      if (['delivered', 'cancelled'].includes(String(order.delivery_status || '').trim().toLowerCase())) {
        throw new Error('Delivery date cannot be changed for a delivered or cancelled order.');
      }
      const date = clean(body.deliveryDate), now = istNowParts();
      if (!dateValid(date) || date < now.date || date > addDays(now.date, 60)) throw new Error('Choose a valid delivery date between today and the next 60 days.');
      const before = { ...order }, plan = date === now.date ? 'Today' : date === addDays(now.date,1) ? 'Tomorrow' : 'Later';
      const dateStatements = [];
      if (order.scheduled_slot_id) {
        // A date-only change releases the time-slot reservation, but keeps the
        // assigned store and its basket-stock reservation intact.
        dateStatements.push(env.DB.prepare("UPDATE delivery_slot_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(orderId));
      }
      dateStatements.push(env.DB.prepare("UPDATE orders SET scheduled_delivery_date=?,scheduled_slot_id=NULL,scheduled_start_minute=NULL,scheduled_end_minute=NULL,schedule_status='confirmed',delivery_plan=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(date,plan,orderId));
      await env.DB.batch(dateStatements);
      await writeAudit(env,orderId,'owner',clean(request.headers.get('X-Freshway-Owner-Id'))||'owner','delivery_date_changed',clean(body.reason),before,{date});
      await notifyCustomerAndOwner(env,orderId,{customer_id:order.customer_id,delivery_status:order.delivery_status,payment_status:order.payment_status,delivery_plan:order.delivery_plan,is_test_order:order.is_test_order},'delivery_date_changed','Delivery date updated to '+date);
      return response({ok:true,orderId,scheduledDelivery:{date}});
    }
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
      'WHERE r.status=\'pending\' OR (r.request_type=\'issue\' AND r.status=\'approved\') ORDER BY CASE WHEN r.status=\'pending\' THEN 0 ELSE 1 END,r.created_at LIMIT 200'
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
    } else if (decision === 'approve' && row.request_type === 'reschedule' && row.requested_delivery_date) {
      const order = await getOrderForAction(env,row.order_id);
      if (!order) throw new Error('Order not found.');
      const date = clean(body.deliveryDate) || row.requested_delivery_date, now = istNowParts();
      if (!dateValid(date) || date < now.date || date > addDays(now.date,60)) throw new Error('Choose a valid delivery date between today and the next 60 days.');
      const plan = date===now.date?'Today':date===addDays(now.date,1)?'Tomorrow':'Later';
      const dateStatements = [];
      if (order.scheduled_slot_id || order.assigned_store_id) {
        dateStatements.push(env.DB.prepare("UPDATE delivery_slot_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(row.order_id));
        dateStatements.push(env.DB.prepare("UPDATE delivery_store_inventory_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(row.order_id));
      }
      dateStatements.push(env.DB.prepare("UPDATE orders SET scheduled_delivery_date=?,scheduled_slot_id=NULL,assigned_store_id=NULL,scheduled_start_minute=NULL,scheduled_end_minute=NULL,schedule_status='confirmed',delivery_plan=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(date,plan,row.order_id));
      await env.DB.batch(dateStatements);
      await writeAudit(env,row.order_id,'owner','owner','delivery_date_change_approved',note,order,{date});
      await notifyCustomerAndOwner(env,row.order_id,{customer_id:order.customer_id,delivery_status:order.delivery_status,payment_status:order.payment_status,delivery_plan:order.delivery_plan,is_test_order:order.is_test_order},'delivery_date_changed','Delivery date updated to '+date);
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
    if (decision === 'reject' && row.request_type === 'reschedule' && row.requested_delivery_date) {
      // Keep the currently selected delivery date unchanged.
    } else if (decision === 'reject' && row.request_type === 'reschedule') {
      const order = await getOrderForAction(env, row.order_id);
      if (order && order.schedule_status === 'change_requested') {
        // Restore the exact status from before the request. Order status alone
        // cannot distinguish a requested schedule from an Owner-confirmed one.
        const priorAudit = await env.DB.prepare(
          "SELECT before_json FROM order_audit_events WHERE order_id=? AND action='reschedule_requested' " +
          "AND json_valid(after_json)=1 AND json_extract(after_json,'$.requestId')=? " +
          "ORDER BY created_at DESC,id DESC LIMIT 1"
        ).bind(row.order_id, requestId).first();
        let priorScheduleStatus = '';
        try { priorScheduleStatus = String(JSON.parse(priorAudit?.before_json || '{}').schedule_status || ''); } catch (_) {}
        const validScheduleStatuses = ['unscheduled','requested','confirmed','conflict','completed','cancelled'];
        const restoredScheduleStatus = validScheduleStatuses.includes(priorScheduleStatus)
          ? priorScheduleStatus
          : order.scheduled_slot_id
            ? (order.delivery_status === 'New' ? 'requested' : 'confirmed')
            : 'unscheduled';
        await env.DB.prepare(
          "UPDATE orders SET schedule_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND schedule_status='change_requested'"
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
