import webpush from 'web-push';
import { getStoreProfile } from './store-profile.js';
import { buildOrderPlacedAlerts, dispatchOrderAlert } from './order-alerts.js';
import { buildOrderChangeAlerts } from './admin-notifications.js';
import { handleReverseGeocode } from './geocode-api.js';
import { validatePushEndpoint } from './push-endpoint.js';
import { prepareCheckoutDelivery, checkoutDeliveryStatements } from './delivery-scheduling.js';
import { calculateOrderPricing, orderRedemptionStatements } from './delivery-offers.js';

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Authorization,X-Freshway-Admin-Token'
  }
});
const origin = env => env.APP_ORIGIN && env.APP_ORIGIN !== 'https://YOUR-FRESHWAY-DOMAIN' ? env.APP_ORIGIN : '*';
const auth = (request, env) => {
  const expected = String(env.ADMIN_TOKEN || '').trim();
  const forwarded = String(request.headers.get('X-Freshway-Admin-Token') || '').trim();
  const authorization = String(request.headers.get('Authorization') || '').trim();
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : authorization;
  const supplied = forwarded || bearer;
  return !!expected && supplied === expected;
};
const body = async request => { try { return await request.json(); } catch (_) { return {}; } };
const now = () => new Date().toISOString();
const cleanPhone = value => { const digits = String(value || '').replace(/\D/g, ''); if (digits.length === 10) return `91${digits}`; if (digits.length === 12 && digits.startsWith('91')) return digits; return digits; };
const orderId = () => `FW-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const validPlans = ['Today','Tomorrow','Later','Unscheduled'];
const stockStatus=(managed,quantity,threshold)=>!managed?'not_tracked':Number(quantity)<=0?'out_of_stock':Number(quantity)<=Number(threshold||0)?'low_stock':'in_stock';

async function products(env, includeInactive = false) {
  const query = includeInactive ? 'SELECT id,name,unit,price,emoji,active,stock_managed,stock_quantity,low_stock_threshold FROM products ORDER BY name' : 'SELECT id,name,unit,price,emoji,active,stock_managed,stock_quantity,low_stock_threshold FROM products WHERE active=1 ORDER BY name';
  const { results } = await env.DB.prepare(query).all(); const mapped=(results||[]).map(p=>({...p,stock_status:stockStatus(p.stock_managed,p.stock_quantity,p.low_stock_threshold)})); if(includeInactive)return mapped; return mapped.map(({stock_managed,stock_quantity,low_stock_threshold,...p})=>p);
}

async function registerCustomer(env, payload) {
  if (!payload.id || !payload.phone) throw new Error('Customer id and phone are required.');
  const phone = cleanPhone(payload.phone);
  if (!/^\d{12}$/.test(phone)) throw new Error('Enter a valid mobile number.');
  await env.DB.prepare(`INSERT INTO customers (id,name,phone,whatsapp_opt_in,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, whatsapp_opt_in=excluded.whatsapp_opt_in, updated_at=CURRENT_TIMESTAMP`)
    .bind(String(payload.id).slice(0, 100), String(payload.name || '').trim().slice(0, 100), phone, payload.whatsappOptIn ? 1 : 0).run();
  return { ok: true };
}

async function validateOrderItems(env, rawItems) {
  const unique = new Map();
  for (const raw of rawItems) {
    const id = String(raw?.id || ''); const qty = Number(raw?.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Invalid cart item.');
    const nextQty = (unique.get(id) || 0) + qty;
    if (nextQty > 99) throw new Error('Maximum quantity for a product is 99.');
    unique.set(id, nextQty);
  }
  const ids = [...unique.keys()]; const placeholders = ids.map(() => '?').join(',');
  const { results: dbProducts } = await env.DB.prepare(`SELECT id,name,unit,price,emoji,stock_managed,stock_quantity,low_stock_threshold,hsn_code,gst_rate_bps,gst_rate_confirmed FROM products WHERE active=1 AND id IN (${placeholders})`).bind(...ids).all();
  if (!dbProducts || dbProducts.length !== ids.length) throw new Error('One or more products are no longer available. Please refresh and try again.');
  const items = dbProducts.map(p => { const qty=unique.get(p.id); if(Number(p.stock_managed)===1&&Number(p.stock_quantity)<qty)throw new Error(`Not enough stock for ${p.name}. Please reduce the quantity and try again.`); return { ...p, qty, lineTotal:p.price*qty, stockReservedQty:Number(p.stock_managed)===1?qty:0 }; });
  return { items, total: items.reduce((sum, item) => sum + item.lineTotal, 0) };
}

function scheduleOrderAlerts(ctx, env, alerts) {
  const work = Promise.all(alerts.map(alert => dispatchOrderAlert(env, alert).catch(error => {
    console.error('FreshWay order alert failed:', error?.message || error);
    return { status: 'failed', sent: 0, failed: 0 };
  })));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  else return work;
}

async function existingOrderByClientId(env, customerId, clientOrderId) {
  if (!clientOrderId) return null;
  const { results } = await env.DB.prepare('SELECT id FROM orders WHERE client_order_id=? AND customer_id=? LIMIT 1').bind(clientOrderId, customerId).all();
  if (!results?.[0]?.id) return null;
  const orders = await customerOrders(env, customerId);
  return orders.find(order => order.id === results[0].id) || null;
}

async function createOrder(env, payload, ctx) {
  const customerId = String(payload.customerId || '').slice(0, 100), customer = payload.customer || {}, address = payload.address || {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const clientOrderId = String(payload.clientOrderId || '').trim().slice(0, 100);
  if (clientOrderId && !/^[A-Za-z0-9_-]{8,100}$/.test(clientOrderId)) throw new Error('Invalid checkout order id.');
  if (!customerId || !customer.name || !customer.phone) throw new Error('Customer details are required.');
  if (!address.house || !address.area || !address.city || !address.pincode) throw new Error('Complete delivery address is required.');
  if (!rawItems.length) throw new Error('Your cart is empty.');
  if (!/^\d{10}$/.test(String(customer.phone))) throw new Error('Enter a valid 10-digit mobile number.');
  if (!/^\d{6}$/.test(String(address.pincode))) throw new Error('Enter a valid 6-digit PIN code.');
  const existing = await existingOrderByClientId(env, customerId, clientOrderId);
  if (existing) return existing;
  const { items } = await validateOrderItems(env, rawItems);
  const pricing = await calculateOrderPricing(env, { items, customerId, couponCode: payload.couponCode || '', forOrder: true });
  const total = pricing.finalTotal;
  if (payload.expectedTotal !== undefined && (!Number.isSafeInteger(Number(payload.expectedTotal)) || Number(payload.expectedTotal) !== total)) throw new Error('ORDER_CONFLICT: The order total changed while checking out. Review your cart and try again.');
  const deliverySelection = await prepareCheckoutDelivery(env, payload, items);
  const phone = cleanPhone(customer.phone), customerName = String(customer.name).trim().slice(0, 100);
  const existingCustomer = await env.DB.prepare('SELECT phone FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
  const registeredPhone = cleanPhone(existingCustomer?.phone);
  const customerPhoneForProfile = /^91\d{10}$/.test(registeredPhone) ? registeredPhone : phone;
  // The account mobile is identity data. Checkout's delivery phone is order data and
  // must never overwrite the customer's registered mobile number.
  await env.DB.prepare(`INSERT INTO customers (id,name,phone,whatsapp_opt_in,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=CASE WHEN customers.name IS NULL OR TRIM(customers.name)='' THEN excluded.name ELSE customers.name END, whatsapp_opt_in=excluded.whatsapp_opt_in, updated_at=CURRENT_TIMESTAMP`)
    .bind(customerId, customerName, customerPhoneForProfile, payload.whatsappOptIn ? 1 : 0).run();
  const addressResult = await env.DB.prepare(`INSERT INTO addresses (customer_id,house,area,city,pincode,landmark,note) VALUES (?,?,?,?,?,?,?)`)
    .bind(customerId, String(address.house).trim().slice(0, 200), String(address.area).trim().slice(0, 200), String(address.city).trim().slice(0, 100), String(address.pincode), String(address.landmark || '').trim().slice(0, 200), String(address.note || '').trim().slice(0, 500)).run();
  const addressId = addressResult?.meta?.last_row_id; if (!addressId) throw new Error('Could not save delivery address.');
  const id = orderId(), createdAt = now();
  const stockUpdates=items.filter(item=>item.stockReservedQty>0).map(item=>env.DB.prepare('UPDATE products SET stock_quantity=stock_quantity-? WHERE id=? AND stock_managed=1').bind(item.stockReservedQty,item.id));
  const deliveryPlan=deliverySelection?.deliveryPlan||'Tomorrow';
  const redemptionStatements=await orderRedemptionStatements(env,id,customerId,pricing);
  const statements=[...stockUpdates,env.DB.prepare(`INSERT INTO orders (id,customer_id,address_id,customer_name,customer_phone,total,items_subtotal,delivery_fee,coupon_id,coupon_code,coupon_discount,payment_status,delivery_status,delivery_plan,client_order_id,created_at,updated_at,scheduled_delivery_date,scheduled_slot_id,assigned_store_id,scheduled_start_minute,scheduled_end_minute,schedule_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'Not Collected','New',?,?,?,?,?,?,?,?,?,?)`).bind(id,customerId,addressId,customerName,phone,total,pricing.itemsSubtotal,pricing.deliveryFee,pricing.couponId,pricing.couponCode,pricing.couponDiscount,1,deliveryPlan,clientOrderId||null,createdAt,createdAt,deliverySelection?.date||null,null,null,null,null,deliverySelection?'requested':'unscheduled'),...redemptionStatements,...items.map(item=>env.DB.prepare(`INSERT INTO order_items (order_id,product_id,name,unit,qty,price,line_total,stock_reserved_qty,hsn_code,gst_rate_bps,gst_rate_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,item.id,item.name,item.unit,item.qty,item.price,item.lineTotal,item.stockReservedQty,item.hsn_code||'',Number(item.gst_rate_bps||0),Number(item.gst_rate_confirmed||0))),...checkoutDeliveryStatements(env,id,deliverySelection,items)];
  try { await env.DB.batch(statements); } catch (error) {
    await env.DB.prepare('DELETE FROM addresses WHERE id=?').bind(addressId).run();
    if (clientOrderId && /unique|constraint/i.test(error?.message || '')) {
      const duplicate = await existingOrderByClientId(env, customerId, clientOrderId);
      if (duplicate) return duplicate;
    }
    if (/DELIVERY_SLOT_FULL|DELIVERY_SLOT_CLOSED/i.test(error?.message || '')) throw new Error('That delivery window just filled. Choose another available time window.');
    if (/DELIVERY_STORE_STOCK_LOW/i.test(error?.message || '')) throw new Error('The selected store can no longer fulfil the full basket. Refresh delivery availability and try again.');
    if (/stock_quantity/i.test(error?.message || '')) throw new Error('Stock changed while you were checking out. Please refresh your cart and try again.');
    throw error;
  }
  const placedAlerts = buildOrderPlacedAlerts({ id, customerId, customerName, total, items });
  const alertWork = scheduleOrderAlerts(ctx, env, placedAlerts);
  if (alertWork) await alertWork;
  return { id, customerId, total, itemsSubtotal:pricing.itemsSubtotal, deliveryFee:pricing.deliveryFee, couponCode:pricing.couponCode, couponDiscount:pricing.couponDiscount, pricingBreakdownKnown:true, payment: 'Not Collected', status: 'New', deliveryPlan, scheduledDelivery: deliverySelection ? { date: deliverySelection.date } : null, createdAt, updatedAt: createdAt, address: { ...address, pincode: String(address.pincode) }, items };
}

async function customerOrders(env, customerId) {
  if (!customerId) throw new Error('Customer id is required.');
  const { results: rows } = await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.total,o.items_subtotal,o.delivery_fee,o.coupon_code,o.coupon_discount,o.pricing_breakdown_known,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.delivered_at,o.payment_collected_at,o.scheduled_delivery_date,a.house,a.area,a.city,a.pincode,a.landmark,a.note,oi.product_id,oi.name,oi.unit,oi.qty,oi.price,oi.line_total FROM orders o JOIN addresses a ON a.id=o.address_id JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id=? AND o.is_test_order=0 ORDER BY o.created_at DESC, oi.id ASC`).bind(customerId).all();
  return groupOrders(rows || []);
}
export function groupOrders(rows) { const map = new Map(); for (const r of rows) { if (!map.has(r.id)) map.set(r.id,{id:r.id,customer:{name:r.customer_name,phone:r.customer_phone},address:{house:r.house,area:r.area,city:r.city,pincode:r.pincode,landmark:r.landmark,note:r.note},items:[],total:r.total,pricingBreakdownKnown:Number(r.pricing_breakdown_known)===1,itemsSubtotal:Number(r.pricing_breakdown_known)===1?r.items_subtotal:null,deliveryFee:Number(r.pricing_breakdown_known)===1?r.delivery_fee:null,couponCode:Number(r.pricing_breakdown_known)===1?(r.coupon_code||null):null,couponDiscount:Number(r.pricing_breakdown_known)===1?r.coupon_discount:null,payment:r.payment_status,status:r.delivery_status,deliveryPlan:r.delivery_plan,createdAt:r.created_at,updatedAt:r.updated_at,deliveredAt:r.delivered_at,paymentCollectedAt:r.payment_collected_at,scheduledDelivery:r.scheduled_delivery_date?{date:r.scheduled_delivery_date}:null}); map.get(r.id).items.push({id:r.product_id,name:r.name,unit:r.unit,qty:r.qty,price:r.price,lineTotal:r.line_total}); } return [...map.values()]; }

const ORDER_STATUSES=['New','Confirmed','Processing','Ready','Out for Delivery','Delivered','Cancelled'];
const ORDER_PAYMENTS=['Not Collected','Collected','Refunded','Cancelled'];
const normalizePaymentFilter=value=>value==='Pending'?'Not Collected':value;

function validateOrderPatch(current,payload={}){
  const status=payload.status, payment=payload.payment, deliveryPlan=payload.deliveryPlan;
  if(status&&!ORDER_STATUSES.includes(status))throw new Error('Invalid delivery status.');
  if(payment&&!ORDER_PAYMENTS.includes(payment))throw new Error('Invalid payment status.');
  if(deliveryPlan&&!validPlans.includes(deliveryPlan))throw new Error('Invalid delivery plan.');
  const nextStatus=status||current.delivery_status;
  if(deliveryPlan&&(current.delivery_status==='Delivered'||current.delivery_status==='Cancelled'||nextStatus==='Delivered'||nextStatus==='Cancelled')){
    throw new Error('Delivery plan cannot be changed after an order is completed or cancelled.');
  }
  return {status,payment,deliveryPlan};
}

async function adminOrders(env,url){
  const page=Math.max(1,Math.min(100,Number.parseInt(url?.searchParams.get('page')||'1',10)||1));
  const limit=Math.max(1,Math.min(100,Number.parseInt(url?.searchParams.get('limit')||'25',10)||25));
  const search=String(url?.searchParams.get('search')||'').trim().slice(0,100);
  const status=String(url?.searchParams.get('status')||'').trim();
  const payment=normalizePaymentFilter(String(url?.searchParams.get('payment')||'').trim());
  const plan=String(url?.searchParams.get('plan')||'').trim();
  const customer=String(url?.searchParams.get('customer')||'').trim().slice(0,100);
  const from=String(url?.searchParams.get('from')||'').trim();
  const to=String(url?.searchParams.get('to')||'').trim();
  const minRaw=url?.searchParams.get('minAmount');
  const maxRaw=url?.searchParams.get('maxAmount');
  const minAmount=minRaw===null||minRaw===''?null:Number(minRaw);
  const maxAmount=maxRaw===null||maxRaw===''?null:Number(maxRaw);
  const sort=String(url?.searchParams.get('sort')||'newest').trim();
  const where=[],binds=[];
  const add=(sql,...values)=>{where.push(sql);binds.push(...values)};
  const testOrders=url?.searchParams.get('testOrders')==='1';
  add(testOrders?'o.is_test_order=1':'o.is_test_order=0');
  if(search){
    const like=`%${search}%`;
    add('(o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR a.house LIKE ? OR a.area LIKE ? OR a.city LIKE ? OR a.pincode LIKE ?)',like,like,like,like,like,like,like);
  }
  if(status&&status!=='all')add('o.delivery_status=?',status);
  if(payment&&payment!=='all')add('o.payment_status=?',payment);
  if(plan&&plan!=='all')add('o.delivery_plan=?',plan);
  if(customer)add('(o.customer_id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)',`%${customer}%`,`%${customer}%`,`%${customer}%`);
  if(/^\d{4}-\d{2}-\d{2}$/.test(from))add("o.created_at>=?",`${from} 00:00:00`);
  if(/^\d{4}-\d{2}-\d{2}$/.test(to))add("o.created_at<=?",`${to} 23:59:59`);
  if(Number.isFinite(minAmount)&&minAmount>=0)add('o.total>=?',Math.round(minAmount));
  if(Number.isFinite(maxAmount)&&maxAmount>=0)add('o.total<=?',Math.round(maxAmount));
  const clause=where.length?` WHERE ${where.join(' AND ')}`:'';
  const sortSql={
    newest:'o.created_at DESC',
    oldest:'o.created_at ASC',
    'value-high':'o.total DESC,o.created_at DESC',
    'value-low':'o.total ASC,o.created_at DESC',
    delivery:"CASE o.delivery_plan WHEN 'Today' THEN 1 WHEN 'Tomorrow' THEN 2 WHEN 'Later' THEN 3 ELSE 4 END,o.created_at ASC"
  }[sort]||'o.created_at DESC';
  const totalRow=await env.DB.prepare(`SELECT COUNT(*) total FROM orders o JOIN addresses a ON a.id=o.address_id${clause}`).bind(...binds).first();
  const total=Number(totalRow?.total||0);
  const offset=(page-1)*limit;
  const {results:orderRows}=await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.is_test_order,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.delivered_at,o.payment_collected_at,a.house,a.area,a.city,a.pincode,a.landmark,a.note FROM orders o JOIN addresses a ON a.id=o.address_id${clause} ORDER BY ${sortSql} LIMIT ? OFFSET ?`).bind(...binds,limit,offset).all();
  const rows=orderRows||[];
  if(!rows.length)return {orders:[],pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
  const ids=rows.map(x=>x.id),placeholders=ids.map(()=>'?').join(',');
  const {results:itemRows}=await env.DB.prepare(`SELECT order_id,product_id,name,unit,qty,price,line_total FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id,id ASC`).bind(...ids).all();
  const itemMap=new Map(ids.map(id=>[id,[]]));
  for(const item of itemRows||[])itemMap.get(item.order_id)?.push({id:item.product_id,name:item.name,unit:item.unit,qty:item.qty,price:item.price,lineTotal:item.line_total});
  const orders=rows.map(r=>({id:r.id,isTestOrder:Number(r.is_test_order)===1,customer:{name:r.customer_name,phone:r.customer_phone},address:{house:r.house,area:r.area,city:r.city,pincode:r.pincode,landmark:r.landmark,note:r.note},items:itemMap.get(r.id)||[],total:r.total,payment:r.payment_status,status:r.delivery_status,deliveryPlan:r.delivery_plan,createdAt:r.created_at,updatedAt:r.updated_at,deliveredAt:r.delivered_at,paymentCollectedAt:r.payment_collected_at}));
  return {orders,pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
}
async function updateOrder(env,id,payload){
  const {results}=await env.DB.prepare('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order,delivered_at FROM orders WHERE id=?').bind(id).all();
  const current=results?.[0];
  if(!current)throw new Error('Order not found.');
  const {status,payment,deliveryPlan}=validateOrderPatch(current,payload);
  const hasTestFlag=typeof payload.isTestOrder==='boolean';
  const nextTestFlag=hasTestFlag?(payload.isTestOrder?1:0):Number(current.is_test_order||0);
  const testClassificationChanged=hasTestFlag&&nextTestFlag!==Number(current.is_test_order||0);
  const sets=[],params=[];
  if(status){sets.push('delivery_status=?');params.push(status)}
  if(status==='Delivered'&&current.delivery_status!=='Delivered'&&!current.delivered_at)sets.push('delivered_at=CURRENT_TIMESTAMP');
  if(payment){sets.push('payment_status=?');params.push(payment);if(payment==='Collected')sets.push('payment_collected_at=CURRENT_TIMESTAMP')}
  if(deliveryPlan){sets.push('delivery_plan=?');params.push(deliveryPlan)}
  if(testClassificationChanged){sets.push('is_test_order=?');params.push(nextTestFlag)}
  if(!sets.length)throw new Error('No order change supplied.');
  sets.push('updated_at=CURRENT_TIMESTAMP');
  const guards=['id=?'],whereParams=[id];
  if(status){guards.push('delivery_status IS ?');whereParams.push(current.delivery_status)}
  if(payment){guards.push('payment_status IS ?');whereParams.push(current.payment_status)}
  if(deliveryPlan){guards.push('delivery_plan IS ?');whereParams.push(current.delivery_plan)}
  if(hasTestFlag){guards.push('is_test_order IS ?');whereParams.push(Number(current.is_test_order||0))}
  const statements=[];
  if(status==='Cancelled'&&status!==current.delivery_status){
    const {results:reserved}=await env.DB.prepare('SELECT product_id,SUM(stock_reserved_qty) stock_reserved_qty FROM order_items WHERE order_id=? AND stock_reserved_qty>0 GROUP BY product_id').bind(id).all();
    statements.push(...(reserved||[]).map(item=>env.DB.prepare('UPDATE products SET stock_quantity=stock_quantity+? WHERE id=?').bind(Number(item.stock_reserved_qty),item.product_id)));
  }
  statements.push(env.DB.prepare(`UPDATE orders SET ${sets.join(',')} WHERE ${guards.join(' AND ')}`).bind(...params,...whereParams));
  try{const batchResult=await env.DB.batch(statements);const updateResult=batchResult?.[batchResult.length-1];if(!updateResult?.meta?.changes)throw new Error('ORDER_CONFLICT: This order changed while you were saving. Refresh the order and try again.')}catch(error){if(/stock_quantity/i.test(error?.message||''))throw new Error('Stock could not be restored safely. Refresh and try again.');throw error}
  const classificationOnlyChange=testClassificationChanged&&!status&&!payment&&!deliveryPlan;
  if(!classificationOnlyChange){
    const after={...current,delivery_status:status||current.delivery_status,payment_status:payment||current.payment_status,delivery_plan:deliveryPlan||current.delivery_plan,is_test_order:nextTestFlag};
    const alerts=buildOrderChangeAlerts(id,current,after,`${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    try{await Promise.all(alerts.map(alert=>dispatchOrderAlert(env,alert)))}catch(error){console.error('FreshWay order status alert failed:',error?.message||error)}
  }
  return {ok:true,status:status||current.delivery_status,payment:payment||current.payment_status,deliveryPlan:deliveryPlan||current.delivery_plan,isTestOrder:nextTestFlag,testClassificationChanged};
}

async function addProduct(env,payload){
  const id=String(payload.id||`p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`).trim().slice(0,100),
    name=String(payload.name||'').trim().slice(0,100),unit=String(payload.unit||'').trim().slice(0,30),
    price=Number(payload.price),emoji=String(payload.emoji||'🛒').slice(0,8),
    stockManaged=payload.stockManaged===true,requestedStock=Number(payload.stockQuantity??0),
    lowStockThreshold=Number(payload.lowStockThreshold??5);
  if(!name||!unit||!Number.isFinite(price)||price<0)throw new Error('Product name, unit and valid price are required.');
  if(!Number.isInteger(requestedStock)||requestedStock<0||!Number.isInteger(lowStockThreshold)||lowStockThreshold<0)throw new Error('Enter valid stock values.');
  const activeStores=stockManaged?Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count||0):0;
  const allStores=stockManaged?Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores').first())?.count||0):0;
  const stockQuantity=stockManaged&&activeStores>1?0:requestedStock;
  const statements=[env.DB.prepare(`INSERT INTO products (id,name,unit,price,emoji,active,stock_managed,stock_quantity,low_stock_threshold) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id,name,unit,Math.round(price),emoji,1,stockManaged?1:0,stockQuantity,lowStockThreshold)];
  if(stockManaged&&allStores>0)statements.push(env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) '+
    'SELECT s.id,?,CASE WHEN ?=1 AND s.is_active=1 THEN ? ELSE 0 END FROM delivery_stores s'
  ).bind(id,activeStores,requestedStock));
  await env.DB.batch(statements);
  return{id,name,unit,price:Math.round(price),emoji,active:1,stock_managed:stockManaged?1:0,
    stock_quantity:stockQuantity,low_stock_threshold:lowStockThreshold,
    stockAllocationRequired:Boolean(stockManaged&&activeStores>1&&requestedStock>0)};
}

async function updateProduct(env,id,payload){
  const current=await env.DB.prepare('SELECT stock_managed,stock_quantity FROM products WHERE id=?').bind(id).first();
  if(!current)throw new Error('Product not found.');
  const currentManaged=Number(current.stock_managed)===1;
  const nextManaged=payload.stockManaged===undefined?currentManaged:payload.stockManaged===true;
  if(currentManaged&&!nextManaged)throw new Error('Stock tracking cannot be disabled after it is enabled.');
  const activeStores=nextManaged?Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count||0):0;
  const allStores=nextManaged?Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores').first())?.count||0):0;
  const changingToManaged=!currentManaged&&nextManaged;
  const storeManagedQuantity=currentManaged&&nextManaged&&activeStores>0;
  const sets=[],params=[];
  let nextStockQuantity=Number(current.stock_quantity||0);
  if(payload.name!==undefined){const v=String(payload.name).trim().slice(0,100);if(!v)throw new Error('Product name cannot be empty.');sets.push('name=?');params.push(v)}
  if(payload.unit!==undefined){const v=String(payload.unit).trim().slice(0,30);if(!v)throw new Error('Product unit cannot be empty.');sets.push('unit=?');params.push(v)}
  if(payload.price!==undefined){const v=Number(payload.price);if(!Number.isFinite(v)||v<0)throw new Error('Invalid price.');sets.push('price=?');params.push(Math.round(v))}
  if(payload.emoji!==undefined){sets.push('emoji=?');params.push(String(payload.emoji).slice(0,8))}
  if(payload.active!==undefined){sets.push('active=?');params.push(payload.active?1:0)}
  if(payload.stockManaged!==undefined){sets.push('stock_managed=?');params.push(nextManaged?1:0)}
  if(payload.stockQuantity!==undefined){
    const v=Number(payload.stockQuantity);
    if(!Number.isInteger(v)||v<0)throw new Error('Invalid stock quantity.');
    if(!storeManagedQuantity){nextStockQuantity=changingToManaged&&activeStores>1?0:v;sets.push('stock_quantity=?');params.push(nextStockQuantity);}
  }
  if(changingToManaged&&activeStores>1&&nextStockQuantity!==0){
    nextStockQuantity=0;sets.push('stock_quantity=?');params.push(0);
  }
  if(payload.lowStockThreshold!==undefined){const v=Number(payload.lowStockThreshold);if(!Number.isInteger(v)||v<0)throw new Error('Invalid low-stock threshold.');sets.push('low_stock_threshold=?');params.push(v)}
  if(!sets.length){
    if(storeManagedQuantity&&payload.stockQuantity!==undefined)throw new Error('Managed stock quantities must be changed in Delivery Scheduling for the selected store.');
    throw new Error('No product change supplied.');
  }
  sets.push('updated_at=CURRENT_TIMESTAMP');params.push(id);
  const statements=[env.DB.prepare(`UPDATE products SET ${sets.join(',')} WHERE id=?`).bind(...params)];
  if(changingToManaged&&allStores>0)statements.push(env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) '+
    'SELECT s.id,?,CASE WHEN ?=1 AND s.is_active=1 THEN ? ELSE 0 END FROM delivery_stores s'
  ).bind(id,activeStores,Number(payload.stockQuantity??current.stock_quantity??0)));
  else if(currentManaged&&nextManaged&&allStores>0)statements.push(env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT s.id,?,0 FROM delivery_stores s'
  ).bind(id));
  const results=await env.DB.batch(statements);
  if(!results?.[0]?.meta?.changes)throw new Error('Product not found.');
  return{ok:true,stockQuantity:nextStockQuantity,stockAllocationRequired:Boolean(changingToManaged&&activeStores>1&&Number(payload.stockQuantity??current.stock_quantity??0)>0)};
}

async function saveSubscription(env,payload){
  const s=payload?.subscription;
  if(!payload.customerId||!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)throw new Error('Invalid push subscription.');
  const endpoint=validatePushEndpoint(s.endpoint);
  const p256dh=String(s.keys.p256dh).trim(),auth=String(s.keys.auth).trim();
  if(!p256dh||!auth||p256dh.length>500||auth.length>500)throw new Error('Invalid push subscription keys.');
  await env.DB.prepare(`INSERT INTO push_subscriptions (customer_id,endpoint,p256dh,auth,expiration_time,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(endpoint) DO UPDATE SET customer_id=excluded.customer_id,p256dh=excluded.p256dh,auth=excluded.auth,expiration_time=excluded.expiration_time,updated_at=CURRENT_TIMESTAMP`).bind(String(payload.customerId).slice(0,100),endpoint,p256dh,auth,s.expirationTime||null).run();
  return{ok:true};
}
async function broadcastPush(env,payload){
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)throw new Error('Web Push VAPID secrets are not configured.');
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  const {results}=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions').all();
  const subscriptions=results||[];
  let success=0,failure=0;
  const dead=new Set(),valid=[];
  for(const row of subscriptions){
    try{validatePushEndpoint(row.endpoint);valid.push(row)}
    catch(_){dead.add(row.endpoint);failure++}
  }
  const message=JSON.stringify({title:payload.title||'FreshWay',body:payload.body||'You have a new FreshWay update.',url:payload.url||'/',tag:payload.tag||`freshway-${Date.now()}`});
  await Promise.all(valid.map(async row=>{
    try{
      const endpoint=validatePushEndpoint(row.endpoint);
      await webpush.sendNotification({endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},message);
      success++;
    }catch(error){
      failure++;
      const status=Number(error?.statusCode||0);
      if(error?.code==='PUSH_ENDPOINT_UNSUPPORTED'||status===404||status===410)dead.add(row.endpoint);
    }
  }));
  if(dead.size){
    try{await env.DB.batch([...dead].map(endpoint=>env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)))}
    catch(error){console.error('FreshWay invalid push subscriptions could not be cleaned up:',error?.message||error)}
  }
  await env.DB.prepare('INSERT INTO notification_log (channel,title,body,recipient_count,success_count,failure_count) VALUES (?,?,?,?,?,?)').bind('app',payload.title||'FreshWay',payload.body||'',subscriptions.length,success,failure).run();
  return{channel:'app',recipients:subscriptions.length,success,failure};
}
async function broadcastWhatsApp(env,payload){if(!env.WHATSAPP_ACCESS_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_GRAPH_VERSION)throw new Error('WhatsApp API secrets are not configured.');if(!payload.templateName)throw new Error('WhatsApp requires an approved template name for broadcast messaging.');const{results}=await env.DB.prepare('SELECT phone FROM customers WHERE phone IS NOT NULL AND whatsapp_opt_in=1').all();const url=`https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;let success=0,failure=0;await Promise.all((results||[]).map(async row=>{try{const response=await fetch(url,{method:'POST',headers:{'Authorization':`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:String(row.phone).replace(/\D/g,''),type:'template',template:{name:payload.templateName,language:{code:payload.languageCode||'en_US'},...(payload.parameters?.length?{components:[{type:'body',parameters:payload.parameters.map(text=>({type:'text',text:String(text)}))}]}:{})}})});if(response.ok)success++;else failure++}catch(_){failure++}}));await env.DB.prepare('INSERT INTO notification_log (channel,title,body,recipient_count,success_count,failure_count) VALUES (?,?,?,?,?,?)').bind('whatsapp',payload.templateName,payload.body||'',results?.length||0,success,failure).run();return{channel:'whatsapp',recipients:results?.length||0,success,failure}}
async function notificationHistory(env){const{results}=await env.DB.prepare('SELECT id,channel,title,body,recipient_count,success_count,failure_count,created_at FROM notification_log ORDER BY created_at DESC,id DESC LIMIT 50').all();return results||[]}

export { normalizePaymentFilter, validateOrderPatch, validateOrderItems, updateOrder, addProduct, updateProduct, createOrder };

export default{async fetch(request,env,ctx){const cors=origin(env);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':cors,'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'Content-Type,Authorization,X-Freshway-Admin-Token'}});const url=new URL(request.url);try{
if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,service:'freshway-api'},200,cors);if(url.pathname==='/api/geocode/reverse'&&request.method==='GET')return handleReverseGeocode(request,{origin:cors,fetcher:fetch,cache:typeof caches!=='undefined'?caches.default:null,waitUntil:promise=>ctx?.waitUntil?.(promise)});if(url.pathname==='/api/store-profile'&&request.method==='GET')return json({storeProfile:await getStoreProfile(env)},200,cors);
if(url.pathname==='/api/products'&&request.method==='GET')return json({products:await products(env,false)},200,cors);
if(url.pathname==='/api/push/public-key'&&request.method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY||null},200,cors);
if(url.pathname==='/api/push/subscribe'&&request.method==='POST')return json(await saveSubscription(env,await body(request)),200,cors);
if(url.pathname==='/api/customers/register'&&request.method==='POST')return json(await registerCustomer(env,await body(request)),200,cors);
if(url.pathname==='/api/orders'&&request.method==='POST')return json(await createOrder(env,await body(request),ctx),201,cors);
if(url.pathname==='/api/orders'&&request.method==='GET')return json({orders:await customerOrders(env,url.searchParams.get('customerId'))},200,cors);
if(url.pathname==='/api/admin/orders'&&request.method==='GET'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json(await adminOrders(env,url),200,cors)}
if(url.pathname.startsWith('/api/admin/orders/')&&request.method==='PATCH'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);const id=decodeURIComponent(url.pathname.split('/').pop());return json(await updateOrder(env,id,await body(request)),200,cors)}
if(url.pathname==='/api/admin/products'&&request.method==='GET'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json({products:await products(env,true)},200,cors)}
if(url.pathname==='/api/admin/products'&&request.method==='POST'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json(await addProduct(env,await body(request)),201,cors)}
if(url.pathname.startsWith('/api/admin/products/')&&request.method==='PATCH'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);const id=decodeURIComponent(url.pathname.split('/').pop());return json(await updateProduct(env,id,await body(request)),200,cors)}
if(url.pathname==='/api/admin/notifications/history'&&request.method==='GET'){if(!auth(request,env))return json({notifications:await notificationHistory(env)},200,cors)}
if(url.pathname==='/api/notifications/broadcast'&&request.method==='POST'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);const payload=await body(request),channels=Array.isArray(payload.channels)?payload.channels:[];if(!channels.length)return json({error:'Select at least one notification channel.'},400,cors);if(channels.some(channel=>!['app','whatsapp'].includes(channel)))return json({error:'Invalid notification channel.'},400,cors);const results=[];if(channels.includes('app'))results.push(await broadcastPush(env,payload));if(channels.includes('whatsapp'))results.push(await broadcastWhatsApp(env,payload));return json({results},200,cors)}
return json({error:'Not found'},404,cors);
}catch(error){const message=error?.message||'Unexpected server error.';const status=/^ORDER_CONFLICT:/.test(message)?409:/Unauthorized/i.test(message)?401:/required|invalid|empty|available|maximum|cannot|not found|no order|no product|only after/i.test(message)?400:500;return json({error:message.replace(/^ORDER_CONFLICT:\s*/, '')},status,cors)}}};