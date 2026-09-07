import original from './index.js';

const COOKIE = 'freshway-customer-session';
const MAX_AGE = 60 * 60 * 24 * 30;
const text = value => new TextEncoder().encode(value);
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const cleanPhone = value => { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 10 ? `91${digits}` : digits; };
const e164 = value => { const phone = cleanPhone(value); return /^91\d{10}$/.test(phone) ? `+${phone}` : ''; };
const clientIp = request => String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim().slice(0, 80) || 'unknown';

async function key(env) {
  const secret = String(env.CUSTOMER_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('Customer session signing is not configured.');
  return crypto.subtle.importKey('raw', text(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signSession(env, customerId) {
  const issued = Math.floor(Date.now() / 1000);
  const payload = `${String(customerId).slice(0, 100)}.${issued}`;
  const signature = await crypto.subtle.sign('HMAC', await key(env), text(payload));
  return `${btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.${hex(new Uint8Array(signature))}`;
}

function cookieValue(request) {
  const raw = request.headers.get('Cookie') || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? match[1] : '';
}

function unhex(value) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sessionCustomerId(request, env) {
  const raw = cookieValue(request);
  if (!raw) return null;
  const [encoded, signatureHex] = raw.split('.');
  if (!encoded || !signatureHex || raw.split('.').length !== 2 || !/^[0-9a-f]{64}$/i.test(signatureHex)) return null;
  let payload;
  try { payload = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4)); }
  catch (_) { return null; }
  const [customerId, issuedRaw, ...extra] = payload.split('.');
  if (extra.length) return null;
  const issued = Number(issuedRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!customerId || !Number.isSafeInteger(issued) || issued < now - MAX_AGE || issued > now + 60) return null;
  try {
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), text(payload)));
    const actual = unhex(signatureHex);
    if (actual.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0 ? customerId : null;
  } catch (_) { return null; }
}

function unauthorized(env) {
  return new Response(JSON.stringify({ error: 'Customer authentication required.' }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': env.APP_ORIGIN || '*',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'Content-Type,Authorization,X-Freshway-Admin-Token',
      'access-control-allow-credentials': 'true',
      'cache-control': 'private, no-store'
    }
  });
}

function withCookie(response, token) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Access-Control-Allow-Credentials', 'true');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function customerExists(env, customerId) {
  const row = await env.DB.prepare('SELECT id FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
  return !!row;
}

async function customerIdForPhone(env, phone) {
  const row = await env.DB.prepare('SELECT id FROM customers WHERE phone=? ORDER BY updated_at DESC LIMIT 1').bind(cleanPhone(phone)).first();
  return row?.id || null;
}

function twilioConfigured(env) {
  return !!(String(env.TWILIO_ACCOUNT_SID || '').trim() && String(env.TWILIO_AUTH_TOKEN || '').trim() && String(env.TWILIO_VERIFY_SERVICE_SID || '').trim());
}

async function twilio(env, path, params) {
  if (!twilioConfigured(env)) throw new Error('SMS OTP is not configured. Add the Twilio Verify secrets in the Worker.');
  const auth = btoa(`${String(env.TWILIO_ACCOUNT_SID).trim()}:${String(env.TWILIO_AUTH_TOKEN).trim()}`);
  const response = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(String(env.TWILIO_VERIFY_SERVICE_SID).trim())}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data.message || '').trim();
    throw new Error(message || 'Could not send or verify the SMS code. Please try again.');
  }
  return data;
}

const RATE_WINDOW = 10 * 60;
const RATE_RULES = { otpStartPhone: 5, otpStartIp: 20, otpVerifyPhone: 10 };
async function rateLimit(env, keyValue, limit) {
  const keyName = String(keyValue).slice(0, 180);
  const windowStart = Math.floor(Date.now() / 1000 / RATE_WINDOW) * RATE_WINDOW;
  await env.DB.prepare(`INSERT INTO auth_rate_limits (key,window_start,count) VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_rate_limits.window_start=? THEN auth_rate_limits.count+1 ELSE 1 END, window_start=?`)
    .bind(keyName, windowStart, windowStart, windowStart).run();
  const row = await env.DB.prepare('SELECT count,window_start FROM auth_rate_limits WHERE key=?').bind(keyName).first();
  return !!row && row.window_start === windowStart && Number(row.count) <= limit;
}

function limited(env, retryAfter = 600) {
  return new Response(JSON.stringify({ error: 'Too many attempts. Please try again later.' }), { status: 429, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': env.APP_ORIGIN || '*',
    'cache-control': 'no-store',
    'retry-after': String(retryAfter)
  }});
}

async function otpStart(request, env) {
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  const phone = e164(payload.phone);
  if (!phone) return new Response(JSON.stringify({ error: 'Enter a valid 10-digit Indian mobile number.' }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*' } });
  const phoneKey = `otp:start:phone:${phone}`;
  const ipKey = `otp:start:ip:${clientIp(request)}`;
  if (!(await rateLimit(env, phoneKey, RATE_RULES.otpStartPhone)) || !(await rateLimit(env, ipKey, RATE_RULES.otpStartIp))) return limited(env);
  await twilio(env, 'Verifications', { To: phone, Channel: 'sms' });
  return new Response(JSON.stringify({ ok: true, phone: `******${phone.slice(-4)}`, expiresIn: 600 }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*', 'cache-control': 'no-store' } });
}

async function otpVerify(request, env) {
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  const phone = e164(payload.phone);
  const code = String(payload.code || '').replace(/\s/g, '');
  if (!phone || !/^\d{4,10}$/.test(code)) return new Response(JSON.stringify({ error: 'Enter the mobile number and OTP.' }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*' } });
  if (!(await rateLimit(env, `otp:verify:phone:${phone}`, RATE_RULES.otpVerifyPhone))) return limited(env);
  const result = await twilio(env, 'VerificationCheck', { To: phone, Code: code });
  if (result.status !== 'approved' || result.valid === false) return new Response(JSON.stringify({ error: 'Incorrect or expired OTP.' }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*' } });
  const customerId = (await customerIdForPhone(env, phone)) || crypto.randomUUID();
  return withCookie(new Response(JSON.stringify({ ok: true, customerId, phone: `******${phone.slice(-4)}` }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*' } }), await signSession(env, customerId));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': env.APP_ORIGIN || '*',
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers': 'Content-Type,Authorization,X-Freshway-Admin-Token',
        'access-control-allow-credentials': 'true'
      }});
    }

    if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/notifications/broadcast') return original.fetch(request, env, ctx);

    if (url.pathname === '/api/auth/session' && request.method === 'GET') {
      const customerId = await sessionCustomerId(request, env);
      if (!customerId || !(await customerExists(env, customerId))) return unauthorized(env);
      return new Response(JSON.stringify({ ok: true, customerId }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*', 'access-control-allow-credentials': 'true', 'cache-control': 'private, no-store' } });
    }

    if (url.pathname === '/api/auth/otp/start' && request.method === 'POST') {
      try { return await otpStart(request, env); } catch (error) { return new Response(JSON.stringify({ error: error.message || 'Could not send SMS OTP.' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*', 'cache-control': 'no-store' } }); }
    }

    if (url.pathname === '/api/auth/otp/verify' && request.method === 'POST') {
      try { return await otpVerify(request, env); } catch (error) { return new Response(JSON.stringify({ error: error.message || 'Could not verify SMS OTP.' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.APP_ORIGIN || '*', 'cache-control': 'no-store' } }); }
    }

    if (url.pathname === '/api/customers/register' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const customerId = String(payload?.id || '').trim().slice(0, 100);
      if (!customerId) return unauthorized(env);
      const sessionId = await sessionCustomerId(request, env);
      if (sessionId !== customerId) return unauthorized(env);
      const response = await original.fetch(request, env, ctx);
      return response.ok ? withCookie(response, await signSession(env, customerId)) : response;
    }

    if (url.pathname === '/api/orders' && request.method === 'GET') {
      const sessionId = await sessionCustomerId(request, env);
      const requestedId = String(url.searchParams.get('customerId') || '').trim();
      if (!sessionId || !requestedId || requestedId !== sessionId || !(await customerExists(env, sessionId))) return unauthorized(env);
      return original.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/orders' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const requestedId = String(payload?.customerId || '').trim();
      const sessionId = await sessionCustomerId(request, env);
      if (!sessionId || !requestedId || requestedId !== sessionId) return unauthorized(env);
      return original.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const requestedId = String(payload?.customerId || '').trim();
      const sessionId = await sessionCustomerId(request, env);
      if (!sessionId || !requestedId || requestedId !== sessionId) return unauthorized(env);
      return original.fetch(request, env, ctx);
    }

    return original.fetch(request, env, ctx);
  }
};