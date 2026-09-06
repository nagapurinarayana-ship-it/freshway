import original from './index.js';

const COOKIE = 'freshway-customer-session';
const MAX_AGE = 60 * 60 * 24 * 30;

const b64 = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const unb64 = value => {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const s = atob(padded);
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
const text = value => new TextEncoder().encode(value);
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

async function key(env) {
  const secret = String(env.ADMIN_TOKEN || '').trim();
  if (!secret) throw new Error('Customer session signing is not configured.');
  return crypto.subtle.importKey('raw', text(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
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

async function sessionCustomerId(request, env) {
  const raw = cookieValue(request);
  if (!raw) return null;
  const [encoded, signatureHex] = raw.split('.');
  if (!encoded || !signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex)) return null;
  let payload;
  try {
    payload = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4));
  } catch (_) { return null; }
  const [customerId, issuedRaw] = payload.split('.');
  const issued = Number(issuedRaw);
  if (!customerId || !Number.isSafeInteger(issued)) return null;
  if (issued < Math.floor(Date.now() / 1000) - MAX_AGE || issued > Math.floor(Date.now() / 1000) + 60) return null;
  try {
    const expected = await crypto.subtle.sign('HMAC', await key(env), text(payload));
    const actual = unhex(signatureHex);
    if (actual.length !== expected.byteLength) return null;
    let diff = 0;
    const expectedBytes = new Uint8Array(expected);
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expectedBytes[i];
    return diff === 0 ? customerId : null;
  } catch (_) { return null; }
}

function unhex(value) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function unauthorized(origin) {
  return new Response(JSON.stringify({ error: 'Customer authentication required.' }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'Content-Type,Authorization,X-Freshway-Admin-Token'
    }
  });
}

function withCookie(response, token) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function clearCookie(response) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function origin(env) {
  return env.APP_ORIGIN && env.APP_ORIGIN !== 'https://YOUR-FRESHWAY-DOMAIN' ? env.APP_ORIGIN : '*';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const allowedOrigin = origin(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers': 'Content-Type,Authorization,X-Freshway-Admin-Token',
        'access-control-allow-credentials': 'true'
      }});
    }

    // Admin authentication remains exclusively owned by the original Worker.
    if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/notifications/broadcast') {
      return original.fetch(request, env, ctx);
    }

    // First registration establishes a signed, HttpOnly customer session.
    if (url.pathname === '/api/customers/register' && request.method === 'POST') {
      let payload;
      try { payload = await request.clone().json(); } catch (_) { payload = {}; }
      const customerId = String(payload?.id || '').trim().slice(0, 100);
      if (!customerId) return unauthorized(allowedOrigin);
      const response = await original.fetch(request, env, ctx);
      if (!response.ok) return response;
      return withCookie(response, await signSession(env, customerId));
    }

    const protectedCustomerRoute =
      (url.pathname === '/api/orders' && ['GET', 'POST'].includes(request.method)) ||
      (url.pathname === '/api/push/subscribe' && request.method === 'POST');

    if (protectedCustomerRoute) {
      const sessionId = await sessionCustomerId(request, env);
      if (!sessionId) return unauthorized(allowedOrigin);

      if (request.method === 'GET' && url.pathname === '/api/orders') {
        const requestedId = String(url.searchParams.get('customerId') || '').trim();
        if (!requestedId || requestedId !== sessionId) return unauthorized(allowedOrigin);
        return original.fetch(request, env, ctx);
      }

      if (request.method === 'POST') {
        let payload;
        try { payload = await request.clone().json(); } catch (_) { payload = {}; }
        const requestedId = String(payload?.customerId || '').trim();
        if (!requestedId || requestedId !== sessionId) return unauthorized(allowedOrigin);
        return original.fetch(request, env, ctx);
      }
    }

    // Public catalogue/health remain public. Everything else falls through to the existing API.
    return original.fetch(request, env, ctx);
  }
};
