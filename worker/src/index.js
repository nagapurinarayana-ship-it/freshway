import webpush from 'web-push';

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
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
const cleanPhone = value => { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 10 ? `91${digits}` : digits; };
const orderId = () => `FW-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const validPlans = ['Today','Tomorrow','Later','Unscheduled'];

async function products(env, includeInactive = false) {
  const query = includeInactive ? 'SELECT id,name,unit,price,emoji,active FROM products ORDER BY name' : 'SELECT id,name,unit,price,emoji,active FROM products WHERE active=1 ORDER BY name';
  const { results } = await env.DB.prepare(query).all(); return results || [];
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
  const { results: dbProducts } = await env.DB.prepare(`SELECT id,name,unit,price,emoji FROM products WHERE active=1 AND id IN (${placeholders})`).bind(...ids).all();
  if (!dbProducts || dbProducts.length !== ids.length) throw new Error('One or more products are no longer available. Please refresh and try again.');
  const items = dbProducts.map(p => ({ ...p, qty: unique.get(p.id), lineTotal: p.price * unique.get(p.id) }));
  return { items, total: items.reduce((sum, item) => sum + item.lineTotal, 0) };
}

async function sendCustomerPush(env, customerId, title, message, url = '/') {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return { sent: 0, failed: 0 };
  const { results } = await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE customer_id=?').bind(customerId).all();
  if (!results?.length) return { sent: 0, failed: 0 };
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  let sent = 0, failed = 0; const dead = [];
  await Promise.all(results.map(async row => {
    try { await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({title,body:message,url,tag:`freshway-order-${customerId}`})); sent++; }
    catch (error) { failed++; if ([404,410].includes(error?.statusCode)) dead.push(row.endpoint); }
  }));
  if (dead.length) await env.DB.batch(dead.map(endpoint => env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)));
  return { sent, failed };
}

async function createOrder(env, payload) {
  const customerId = String(payload.customerId || '').slice(0, 100), customer = payload.customer || {}, address = payload.address || {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!customerId || !customer.name || !customer.phone) throw new Error('Customer details are required.');
  if (!address.house || !address.area || !address.city || !address.pincode) throw new Error('Complete delivery address is required.');
  if (!rawItems.length) throw new Error('Your cart is empty.');
  if (!/^\d{10}$/.test(String(customer.phone))) throw new Error('Enter a valid 10-digit mobile number.');
  if (!/^\d{6}$/.test(String(address.pincode))) throw new Error('Enter a valid 6-digit PIN code.');
  const { items, total } = await validateOrderItems(env, rawItems);
  const phone = cleanPhone(customer.phone), customerName = String(customer.name).trim().slice(0, 100);
  await env.DB.prepare(`INSERT INTO customers (id,name,phone,whatsapp_opt_in,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, whatsapp_opt_in=excluded.whatsapp_opt_in, updated_at=CURRENT_TIMESTAMP`)
    .bind(customerId, customerName, phone, payload.whatsappOptIn ? 1 : 0).run();
  const addressResult = await env.DB.prepare(`INSERT INTO addresses (customer_id,house,area,city,pincode,landmark,note) VALUES (?,?,?,?,?,?,?)`)
    .bind(customerId, String(address.house).trim().slice(0, 200), String(address.area).trim().slice(0, 200), String(address.city).trim().slice(0, 100), String(address.pincode), String(address.landmark || '').trim().slice(0, 200), String(address.note || '').trim().slice(0, 500)).run();
  const addressId = addressResult?.meta?.last_row_id; if (!addressId) throw new Error('Could not save delivery address.');
  const id = orderId(), createdAt = now();
  const statements = [env.DB.prepare(`INSERT INTO orders (id,customer_id,address_id,customer_name,customer_phone,total,payment_status,delivery_status,delivery_plan,created_at,updated_at) VALUES (?,?,?,?,?,?, 'Pending','Ordered','Tomorrow',?,?)`).bind(id, customerId, addressId, customerName, phone, total, createdAt, createdAt), ...items.map(item => env.DB.prepare(`INSERT INTO order_items (order_id,product_id,name,unit,qty,price,line_total) VALUES (?,?,?,?,?,?,?)`).bind(id, item.id, item.name, item.unit, item.qty, item.price, item.lineTotal))];
  try { await env.DB.batch(statements); } catch (error) { await env.DB.prepare('DELETE FROM addresses WHERE id=?').bind(addressId).run(); throw error; }
  try { await sendCustomerPush(env, customerId, 'FreshWay order placed', `Order ${id} is confirmed. Delivery is planned for tomorrow or when your route is available.`); } catch (_) {}
  return { id, customerId, total, payment: 'Pending', status: 'Ordered', deliveryPlan: 'Tomorrow', createdAt, updatedAt: createdAt, address: { ...address, pincode: String(address.pincode) }, items };
}

async function customerOrders(env, customerId) {
  if (!customerId) throw new Error('Customer id is required.');
  const { results: rows } = await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.payment_collected_at,a.house,a.area,a.city,a.pincode,a.landmark,a.note,oi.product_id,oi.name,oi.unit,oi.qty,oi.price,oi.line_total FROM orders o JOIN addresses a ON a.id=o.address_id JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id=? ORDER BY o.created_at DESC, oi.id ASC`).bind(customerId).all();
  return groupOrders(rows || []);
}
function groupOrders(rows) { const map = new Map(); for (const r of rows) { if (!map.has(r.id)) map.set(r.id,{id:r.id,customer:{name:r.customer_name,phone:r.customer_phone},address:{house:r.house,area:r.area,city:r.city,pincode:r.pincode,landmark:r.landmark,note:r.note},items:[],total:r.total,payment:r.payment_status,status:r.delivery_status,deliveryPlan:r.delivery_plan,createdAt:r.created_at,updatedAt:r.updated_at,paymentCollectedAt:r.payment_collected_at}); map.get(r.id).items.push({id:r.product_id,name:r.name,unit:r.unit,qty:r.qty,price:r.price,lineTotal:r.line_total}); } return [...map.values()]; }

async function adminOrders(env) {
  const { results } = await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.payment_collected_at,a.house,a.area,a.city,a.pincode,a.landmark,a.note,oi.product_id,oi.name,oi.unit,oi.qty,oi.price,oi.line_total FROM orders o JOIN addresses a ON a.id=o.address_id JOIN order_items oi ON oi.order_id=o.id ORDER BY o.created_at DESC, oi.id ASC`).all();
  return groupOrders(results || []);
}

async function updateOrder(env, id, payload) {
  const allowedStatus=['Ordered','Processing','Delivered','Cancelled'], allowedPayment=['Pending','Collected'];
  const status=payload.status, payment=payload.payment, deliveryPlan=payload.deliveryPlan;
  if (status && !allowedStatus.includes(status)) throw new Error('Invalid delivery status.');
  if (payment && !allowedPayment.includes(payment)) throw new Error('Invalid payment status.');
  if (deliveryPlan && !validPlans.includes(deliveryPlan)) throw new Error('Invalid delivery plan.');
  const { results }=await env.DB.prepare('SELECT delivery_status,payment_status,delivery_plan,customer_id FROM orders WHERE id=?').bind(id).all(); const current=results?.[0];
  if (!current) throw new Error('Order not found.');
  if (status && status!==current.delivery_status) {
    const allowedNext={Ordered:['Processing','Delivered','Cancelled'],Processing:['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
    if (!allowedNext[current.delivery_status]?.includes(status)) throw new Error(`Cannot change ${current.delivery_status} order to ${status}.`);
  }
  if (deliveryPlan && (current.delivery_status==='Delivered'||current.delivery_status==='Cancelled'||status==='Delivered'||status==='Cancelled')) throw new Error('Delivery plan cannot be changed after an order is completed or cancelled.');
  if (payment==='Collected' && (status || current.delivery_status) !== 'Delivered') throw new Error('Cash can be marked collected only after delivery.');
  if (current.payment_status==='Collected' && payment==='Pending') throw new Error('Collected cash cannot be changed back to pending.');
  const sets=[],params=[];
  if(status){sets.push('delivery_status=?');params.push(status)}
  if(payment){sets.push('payment_status=?');params.push(payment);if(payment==='Collected')sets.push('payment_collected_at=CURRENT_TIMESTAMP');else sets.push('payment_collected_at=NULL')}
  if(deliveryPlan){sets.push('delivery_plan=?');params.push(deliveryPlan)}
  if(!sets.length) throw new Error('No order change supplied.'); sets.push('updated_at=CURRENT_TIMESTAMP'); params.push(id);
  const result=await env.DB.prepare(`UPDATE orders SET ${sets.join(',')} WHERE id=?`).bind(...params).run(); if(!result.meta?.changes)throw new Error('Order not found.');
  if (status && status!==current.delivery_status) {
    const text = status==='Processing' ? `Order ${id} is now being prepared.` : status==='Delivered' ? `Order ${id} has been delivered.` : status==='Cancelled' ? `Order ${id} has been cancelled.` : `Order ${id} status is ${status}.`;
    try { await sendCustomerPush(env,current.customer_id,'FreshWay order update',text); } catch (_) {}
  }
  return {ok:true,status:status||current.delivery_status,payment:payment||current.payment_status,deliveryPlan:deliveryPlan||current.delivery_plan};
}

async function addProduct(env,payload){const id=String(payload.id||`p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`).trim().slice(0,100),name=String(payload.name||'').trim().slice(0,100),unit=String(payload.unit||'').trim().slice(0,30),price=Number(payload.price),emoji=String(payload.emoji||'🍎').slice(0,8);if(!name||!unit||!Number.isFinite(price)||price<0)throw new Error('Product name, unit and valid price are required.');await env.DB.prepare(`INSERT INTO products (id,name,unit,price,emoji,active) VALUES (?,?,?,?,?,1)`).bind(id,name,unit,Math.round(price),emoji).run();return{id,name,unit,price:Math.round(price),emoji,active:1}}
async function updateProduct(env,id,payload){const sets=[],params=[];if(payload.name!==undefined){const v=String(payload.name).trim().slice(0,100);if(!v)throw new Error('Product name cannot be empty.');sets.push('name=?');params.push(v)}if(payload.unit!==undefined){const v=String(payload.unit).trim().slice(0,30);if(!v)throw new Error('Product unit cannot be empty.');sets.push('unit=?');params.push(v)}if(payload.price!==undefined){const v=Number(payload.price);if(!Number.isFinite(v)||v<0)throw new Error('Invalid price.');sets.push('price=?');params.push(Math.round(v))}if(payload.emoji!==undefined){sets.push('emoji=?');params.push(String(payload.emoji).slice(0,8))}if(payload.active!==undefined){sets.push('active=?');params.push(payload.active?1:0)}if(!sets.length)throw new Error('No product change supplied.');sets.push('updated_at=CURRENT_TIMESTAMP');params.push(id);const result=await env.DB.prepare(`UPDATE products SET ${sets.join(',')} WHERE id=?`).bind(...params).run();if(!result.meta?.changes)throw new Error('Product not found.');return{ok:true}}

async function saveSubscription(env,payload){const s=payload.subscription;if(!payload.customerId||!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)throw new Error('Invalid push subscription.');await env.DB.prepare(`INSERT INTO push_subscriptions (customer_id,endpoint,p256dh,auth,expiration_time,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(endpoint) DO UPDATE SET customer_id=excluded.customer_id,p256dh=excluded.p256dh,auth=excluded.auth,expiration_time=excluded.expiration_time,updated_at=CURRENT_TIMESTAMP`).bind(String(payload.customerId).slice(0,100),s.endpoint,s.keys.p256dh,s.keys.auth,s.expirationTime||null).run();return{ok:true}}
async function broadcastPush(env,payload){if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)throw new Error('Web Push VAPID secrets are not configured.');webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);const{results}=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions').all();let success=0,failure=0;const dead=[];await Promise.all((results||[]).map(async row=>{try{await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({title:payload.title||'FreshWay',body:payload.body||'You have a new FreshWay update.',url:payload.url||'/',tag:payload.tag||`freshway-${Date.now()}`}));success++}catch(error){failure++;const status=error?.statusCode||0;if(status===404||status===410)dead.push(row.endpoint)}}));if(dead.length)await env.DB.batch(dead.map(endpoint=>env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)));await env.DB.prepare('INSERT INTO notification_log (channel,title,body,recipient_count,success_count,failure_count) VALUES (?,?,?,?,?,?)').bind('app',payload.title||'FreshWay',payload.body||'',results?.length||0,success,failure).run();return{channel:'app',recipients:results?.length||0,success,failure}}
async function broadcastWhatsApp(env,payload){if(!env.WHATSAPP_ACCESS_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_GRAPH_VERSION)throw new Error('WhatsApp API secrets are not configured.');if(!payload.templateName)throw new Error('WhatsApp requires an approved template name for broadcast messaging.');const{results}=await env.DB.prepare('SELECT phone FROM customers WHERE phone IS NOT NULL AND whatsapp_opt_in=1').all();const url=`https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;let success=0,failure=0;await Promise.all((results||[]).map(async row=>{try{const response=await fetch(url,{method:'POST',headers:{'Authorization':`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:String(row.phone).replace(/\D/g,''),type:'template',template:{name:payload.templateName,language:{code:payload.languageCode||'en_US'},...(payload.parameters?.length?{components:[{type:'body',parameters:payload.parameters.map(text=>({type:'text',text:String(text)}))}]}:{})}})});if(response.ok)success++;else failure++}catch(_){failure++}}));await env.DB.prepare('INSERT INTO notification_log (channel,title,body,recipient_count,success_count,failure_count) VALUES (?,?,?,?,?,?)').bind('whatsapp',payload.templateName,payload.body||'',results?.length||0,success,failure).run();return{channel:'whatsapp',recipients:results?.length||0,success,failure}}
async function notificationHistory(env){const{results}=await env.DB.prepare('SELECT id,channel,title,body,recipient_count,success_count,failure_count,created_at FROM notification_log ORDER BY created_at DESC,id DESC LIMIT 50').all();return results||[]}

export default{async fetch(request,env){const cors=origin(env);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':cors,'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'Content-Type,Authorization,X-Freshway-Admin-Token'}});const url=new URL(request.url);try{
if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,service:'freshway-api'},200,cors);
if(url.pathname==='/api/products'&&request.method==='GET')return json({products:await products(env,false)},200,cors);
if(url.pathname==='/api/push/public-key'&&request.method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY||null},200,cors);
if(url.pathname==='/api/push/subscribe'&&request.method==='POST')return json(await saveSubscription(env,await body(request)),200,cors);
if(url.pathname==='/api/customers/register'&&request.method==='POST')return json(await registerCustomer(env,await body(request)),200,cors);
if(url.pathname==='/api/orders'&&request.method==='POST')return json(await createOrder(env,await body(request)),201,cors);
if(url.pathname==='/api/orders'&&request.method==='GET')return json({orders:await customerOrders(env,url.searchParams.get('customerId'))},200,cors);
if(url.pathname==='/api/admin/orders'&&request.method==='GET'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json({orders:await adminOrders(env)},200,cors)}
if(url.pathname.startsWith('/api/admin/orders/')&&request.method==='PATCH'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);const id=decodeURIComponent(url.pathname.split('/').pop());return json(await updateOrder(env,id,await body(request)),200,cors)}
if(url.pathname==='/api/admin/products'&&request.method==='GET'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json({products:await products(env,true)},200,cors)}
if(url.pathname==='/api/admin/products'&&request.method==='POST'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json(await addProduct(env,await body(request)),201,cors)}
if(url.pathname.startsWith('/api/admin/products/')&&request.method==='PATCH'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);const id=decodeURIComponent(url.pathname.split('/').pop());return json(await updateProduct(env,id,await body(request)),200,cors)}
if(url.pathname==='/api/admin/notifications/history'&&request.method==='GET'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);return json({notifications:await notificationHistory(env)},200,cors)}
if(url.pathname==='/api/notifications/broadcast'&&request.method==='POST'){if(!auth(request,env))return json({error:'Unauthorized'},401,cors);const payload=await body(request),channels=Array.isArray(payload.channels)?payload.channels:[];if(!channels.length)return json({error:'Select at least one notification channel.'},400,cors);if(channels.some(channel=>!['app','whatsapp'].includes(channel)))return json({error:'Invalid notification channel.'},400,cors);const results=[];if(channels.includes('app'))results.push(await broadcastPush(env,payload));if(channels.includes('whatsapp'))results.push(await broadcastWhatsApp(env,payload));return json({results},200,cors)}
return json({error:'Not found'},404,cors);
}catch(error){const message=error?.message||'Unexpected server error.';const status=/Unauthorized/i.test(message)?401:/required|invalid|empty|available|maximum|cannot|not found|no order|no product|only after/i.test(message)?400:500;return json({error:message},status,cors)}}};
