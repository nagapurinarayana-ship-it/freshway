import webpush from 'web-push';

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Authorization'
  }
});

function origin(env) { return env.APP_ORIGIN && env.APP_ORIGIN !== 'https://YOUR-FRESHWAY-DOMAIN' ? env.APP_ORIGIN : '*'; }
function auth(request, env) {
  const header = request.headers.get('Authorization') || '';
  return !!env.ADMIN_TOKEN && header === `Bearer ${env.ADMIN_TOKEN}`;
}
async function body(request) { try { return await request.json(); } catch (_) { return {}; } }

async function saveSubscription(env, payload) {
  const s = payload.subscription;
  if (!payload.customerId || !s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) throw new Error('Invalid push subscription.');
  await env.DB.prepare(`INSERT INTO push_subscriptions (customer_id, endpoint, p256dh, auth, expiration_time, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET customer_id=excluded.customer_id, p256dh=excluded.p256dh, auth=excluded.auth, expiration_time=excluded.expiration_time, updated_at=CURRENT_TIMESTAMP`)
    .bind(payload.customerId, s.endpoint, s.keys.p256dh, s.keys.auth, s.expirationTime || null).run();
}

async function broadcastPush(env, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error('Web Push VAPID secrets are not configured.');
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
  let success = 0, failure = 0;
  const dead = [];
  await Promise.all((results || []).map(async row => {
    try {
      await webpush.sendNotification({endpoint: row.endpoint, keys: {p256dh: row.p256dh, auth: row.auth}}, JSON.stringify({
        title: payload.title || 'FreshWay',
        body: payload.body || 'You have a new FreshWay update.',
        url: payload.url || '/',
        tag: payload.tag || `freshway-${Date.now()}`
      }));
      success++;
    } catch (error) {
      failure++;
      const status = error?.statusCode || 0;
      if (status === 404 || status === 410) dead.push(row.endpoint);
    }
  }));
  if (dead.length) {
    await env.DB.batch(dead.map(endpoint => env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint)));
  }
  await env.DB.prepare('INSERT INTO notification_log (channel,title,body,recipient_count,success_count,failure_count) VALUES (?,?,?,?,?,?)')
    .bind('app', payload.title || 'FreshWay', payload.body || '', results?.length || 0, success, failure).run();
  return {channel: 'app', recipients: results?.length || 0, success, failure};
}

async function broadcastWhatsApp(env, payload) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_GRAPH_VERSION) throw new Error('WhatsApp API secrets are not configured.');
  if (!payload.templateName) throw new Error('WhatsApp requires an approved template name for broadcast messaging.');
  const { results } = await env.DB.prepare('SELECT phone FROM customers WHERE phone IS NOT NULL AND whatsapp_opt_in=1').all();
  const url = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  let success = 0, failure = 0;
  await Promise.all((results || []).map(async row => {
    const normalized = String(row.phone).replace(/\D/g, '');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({messaging_product:'whatsapp', to: normalized, type:'template', template:{name:payload.templateName, language:{code:payload.languageCode || 'en_US'}, ...(payload.parameters?.length ? {components:[{type:'body',parameters:payload.parameters.map(text => ({type:'text',text:String(text)}))}]} : {})}})
      });
      if (response.ok) success++; else failure++;
    } catch (_) { failure++; }
  }));
  await env.DB.prepare('INSERT INTO notification_log (channel,title,body,recipient_count,success_count,failure_count) VALUES (?,?,?,?,?,?)')
    .bind('whatsapp', payload.templateName, payload.body || '', results?.length || 0, success, failure).run();
  return {channel: 'whatsapp', recipients: results?.length || 0, success, failure};
}

export default {
  async fetch(request, env) {
    const cors = origin(env);
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{'access-control-allow-origin':cors,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Authorization'}});
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/push/public-key' && request.method === 'GET') {
        if (!env.VAPID_PUBLIC_KEY) return json({error:'Push is not configured yet.'}, 503, cors);
        return json({publicKey: env.VAPID_PUBLIC_KEY}, 200, cors);
      }
      if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        await saveSubscription(env, await body(request));
        return json({ok:true}, 200, cors);
      }
      if (url.pathname === '/api/notifications/broadcast' && request.method === 'POST') {
        if (!auth(request, env)) return json({error:'Unauthorized'}, 401, cors);
        const payload = await body(request);
        const channels = payload.channels || ['app'];
        const results = [];
        if (channels.includes('app')) results.push(await broadcastPush(env, payload));
        if (channels.includes('whatsapp')) results.push(await broadcastWhatsApp(env, payload));
        return json({ok:true, results}, 200, cors);
      }
      if (url.pathname === '/api/health') return json({ok:true, service:'freshway-api'}, 200, cors);
      return json({error:'Not found'}, 404, cors);
    } catch (error) {
      return json({error: error?.message || 'Server error'}, 500, cors);
    }
  }
};
