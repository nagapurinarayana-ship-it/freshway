import original from './index.js';

const COOKIE = 'freshway-customer-session';
const MAX_AGE = 60 * 60 * 24 * 30;
const text = value => new TextEncoder().encode(value);
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

async function key(env) {
  const secret = String(env.ADMIN_TOKEN || '').trim();
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
  if (!encoded || !signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex)) return null;
  let payload;
  try { payload = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4)); }
  catch (_) { return null; }
  const [customerId, issuedRaw] = payload.split('.');
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
      'cache-control': 'private, no-store'
    }
  });
}

function withCookie(response, token) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function customerExists(env, customerId) {
  const row = await env.DB.prepare('SELECT id FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
  return !!row;
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

    // Admin authentication stays exclusively inside the existing Worker.
    if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/notifications/broadcast') {
      return original.fetch(request, env, ctx);
    }

    // Registration is allowed for a new customer. An existing customer can only
    // refresh/update their registration while already holding their signed session.
    if (url.pathname === '/api/customers/register' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const customerId = String(payload?.id || '').trim().slice(0, 100);
      if (!customerId) return unauthorized(env);
      const sessionId = await sessionCustomerId(request, env);
      if (await customerExists(env, customerId) && sessionId !== customerId) return unauthorized(env);
      const response = await original.fetch(request, env, ctx);
      return response.ok ? withCookie(response, await signSession(env, customerId)) : response;
    }

    if (url.pathname === '/api/orders' && request.method === 'GET') {
      const sessionId = await sessionCustomerId(request, env);
      const requestedId = String(url.searchParams.get('customerId') || '').trim();
      if (!sessionId || !requestedId || requestedId !== sessionId) return unauthorized(env);
      return original.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/orders' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const requestedId = String(payload?.customerId || '').trim();
      if (!requestedId) return unauthorized(env);
      const sessionId = await sessionCustomerId(request, env);

      // First order establishes ownership for a new random customer ID. Once the
      // ID exists in D1, a signed session is mandatory, preventing ID swapping.
      if (sessionId !== requestedId && await customerExists(env, requestedId)) return unauthorized(env);
      if (sessionId && sessionId !== requestedId) return unauthorized(env);

      const response = await original.fetch(request, env, ctx);
      return response.ok ? withCookie(response, await signSession(env, requestedId)) : response;
    }

    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const requestedId = String(payload?.customerId || '').trim();
      const sessionId = await sessionCustomerId(request, env);
      if (!sessionId || !requestedId || requestedId !== sessionId) return unauthorized(env);
      return original.fetch(request, env, ctx);
    }

    // Public catalogue, health and public-key endpoints remain public.
    return original.fetch(request, env, ctx);
  }
};
