import original from './index.js';
import { handleAddress, saveOrderSnapshot } from './address-api.js';
import { getInvoiceRecord } from './invoice-service.js';
import { createInvoicePdf } from './invoice-pdf.js';

const COOKIE = 'freshway-customer-session';
const MAX_AGE = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 100000;
const enc = value => new TextEncoder().encode(String(value));
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const bytesFromHex = value => { const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out; };
const corsOrigins = env => [...new Set([env.APP_ORIGINS, env.APP_ORIGIN].flatMap(value => String(value || '').split(',').map(origin => origin.trim())).filter(value => value && value !== 'https://YOUR-FRESHWAY-DOMAIN' && value !== 'null'))];
const allowedOriginSuffixes = env => String(env.APP_ORIGIN_SUFFIXES || '').split(',').map(value => value.trim().toLowerCase()).filter(value => /^\.[a-z0-9.-]+$/.test(value));
const isAllowedOrigin = (env, origin) => {
  if (corsOrigins(env).includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin && allowedOriginSuffixes(env).some(suffix => url.hostname.length > suffix.length && url.hostname.endsWith(suffix));
  } catch (_) { return false; }
};
const corsOrigin = (env, requested = '') => { const origins = corsOrigins(env), origin = String(requested || '').trim(); return origin && isAllowedOrigin(env, origin) ? origin : origins[0] || 'null'; };
const cleanPhone = value => { const digits = String(value || '').replace(/\D/g, ''); if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2); return digits.length === 10 ? digits : ''; };
const normalizedPhone = value => { const phone = cleanPhone(value); return phone ? `91${phone}` : ''; };
const clientIp = request => String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim().slice(0, 80) || 'unknown';
function response(data, status, env, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': corsOrigin(env), 'access-control-allow-credentials': 'true', 'cache-control': 'private, no-store', ...extra } }); }
async function sessionKey(env) { const secret = String(env.CUSTOMER_SESSION_SECRET || '').trim(); if (!secret) throw new Error('Customer session signing is not configured.'); return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); }
async function signSession(env, customerId) {
  const issued = Math.floor(Date.now() / 1000);
  const account = await env.DB.prepare('SELECT auth_version FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
  const version = Math.max(0, Number(account?.auth_version || 0));
  const payload = String(customerId).slice(0, 100) + '.' + issued + '.' + version;
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env), enc(payload));
  const encoded = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return encoded + '.' + hex(new Uint8Array(signature));
}
function cookieValue(request) { const raw = request.headers.get('Cookie') || ''; const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); return match ? match[1] : ''; }
async function sessionCustomerId(request, env) {
  const raw = cookieValue(request);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2 || !/^[0-9a-f]{64}$/i.test(parts[1])) return null;
  let payload;
  try { payload = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[0].length + 3) % 4)); }
  catch (_) { return null; }
  const [customerId, issuedRaw, versionRaw, ...extra] = payload.split('.');
  if (extra.length || !customerId) return null;
  const issued = Number(issuedRaw), now = Math.floor(Date.now() / 1000);
  const version = versionRaw === undefined ? 0 : Number(versionRaw);
  if (!Number.isSafeInteger(issued) || issued < now - MAX_AGE || issued > now + 60 ||
      !Number.isSafeInteger(version) || version < 0) return null;
  try {
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), enc(payload)));
    const actual = bytesFromHex(parts[1]);
    if (actual.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    if (diff !== 0) return null;
    const account = await env.DB.prepare('SELECT auth_version FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
    if (!account || Math.max(0, Number(account.auth_version || 0)) !== version) return null;
    return customerId;
  } catch (_) { return null; }
}
function withSession(data, env, token) { const res = response(data, 200, env); const headers = new Headers(res.headers); headers.append('Set-Cookie', `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=None`); return new Response(res.body, { status: res.status, headers }); }
function clearSession(env) { return response({ ok: true }, 200, env, { 'Set-Cookie': `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None` }); }
function safeInvoiceFilename(invoice){return 'FreshWay-invoice-'+String(invoice.invoiceNumber||invoice.orderId||'order').replace(/[^A-Za-z0-9_-]/g,'-')+'.pdf'}
async function customerInvoice(request,env,encodedOrderId){
  const origin=corsOrigin(env,request.headers.get('Origin')||'');
  const fail=(data,status)=>response(data,status,env,{'access-control-allow-origin':origin});
  const customerId=await sessionCustomerId(request,env);
  if(!customerId||!(await customerExists(env,customerId)))return fail({error:'Customer authentication required.'},401);
  let orderId='';try{orderId=decodeURIComponent(encodedOrderId)}catch(_){return fail({error:'Invoice not found.'},404)}
  const invoice=await getInvoiceRecord(env,orderId);
  if(!invoice||invoice.customerId!==customerId)return fail({error:'Invoice is not available for this order.'},404);
  const bytes=await createInvoicePdf(invoice);
  return new Response(bytes,{status:200,headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="'+safeInvoiceFilename(invoice)+'"','cache-control':'private, no-store','access-control-allow-origin':origin,'access-control-allow-credentials':'true','vary':'Origin','x-content-type-options':'nosniff'}});
}
async function rateLimit(env, key, limit) { const windowStart = Math.floor(Date.now() / 1000 / 600) * 600; const keyName = String(key).slice(0, 180); await env.DB.prepare(`INSERT INTO auth_rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_rate_limits.window_start=? THEN auth_rate_limits.count+1 ELSE 1 END, window_start=?, updated_at=CURRENT_TIMESTAMP`).bind(keyName, windowStart, windowStart, windowStart).run(); const row = await env.DB.prepare('SELECT count,window_start FROM auth_rate_limits WHERE key=?').bind(keyName).first(); return !!row && Number(row.window_start) === windowStart && Number(row.count) <= limit; }
function limited(env) { return response({ error: 'Too many attempts. Please try again later.' }, 429, env, { 'retry-after': '600' }); }
function whatsappOtpConfigured(env) {
  return !!(String(env.WHATSAPP_ACCESS_TOKEN || '').trim() &&
    String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim() &&
    String(env.WHATSAPP_GRAPH_VERSION || '').trim() &&
    /^[a-z0-9_]{3,100}$/i.test(String(env.WHATSAPP_AUTH_TEMPLATE_NAME || '').trim()));
}
async function otpDigest(env, challengeId, phone, code) {
  const secret = String(env.CUSTOMER_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('Customer session signing is not configured.');
  const bytes = await crypto.subtle.digest('SHA-256', enc(secret + ':' + challengeId + ':' + phone + ':' + code));
  return hex(new Uint8Array(bytes));
}
function constantTimeTextEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function sendWhatsAppOtp(env, phone, code) {
  const version = String(env.WHATSAPP_GRAPH_VERSION || '').trim();
  const templateName = String(env.WHATSAPP_AUTH_TEMPLATE_NAME || '').trim();
  const language = String(env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE || 'en_US').trim();
  const url = 'https://graph.facebook.com/' + version + '/' + String(env.WHATSAPP_PHONE_NUMBER_ID).trim() + '/messages';
  const result = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + String(env.WHATSAPP_ACCESS_TOKEN).trim(), 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }
        ]
      }
    })
  });
  if (!result.ok) {
    console.error('FreshWay WhatsApp OTP provider rejected a request.', result.status);
    throw new Error('WHATSAPP_OTP_SEND_FAILED');
  }
}
async function startWhatsAppOtp(request, env) {
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  const phone = normalizedPhone(payload.phone);
  if (!phone) return response({ error: 'Enter a valid 10-digit Indian mobile number.' }, 400, env);
  if (!whatsappOtpConfigured(env)) return response({ error: 'WhatsApp login is not configured yet. Please try again later.' }, 503, env);
  if (!(await rateLimit(env, 'auth:whatsapp-otp:start:phone:' + phone, 3)) ||
      !(await rateLimit(env, 'auth:whatsapp-otp:start:ip:' + clientIp(request), 10))) return limited(env);
  const challengeId = crypto.randomUUID();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 300;
  const codeHash = await otpDigest(env, challengeId, phone, code);
  await env.DB.prepare('DELETE FROM customer_auth_otps WHERE expires_at<? OR (consumed_at IS NOT NULL AND consumed_at<?)').bind(now, now - 86400).run();
  await env.DB.prepare('UPDATE customer_auth_otps SET consumed_at=? WHERE phone=? AND consumed_at IS NULL').bind(now, phone).run();
  await env.DB.prepare('INSERT INTO customer_auth_otps (id,phone,code_hash,expires_at,attempts,consumed_at,created_at) VALUES (?,?,?,?,0,NULL,?)')
    .bind(challengeId, phone, codeHash, expiresAt, now).run();
  try {
    await sendWhatsAppOtp(env, phone, code);
  } catch (_) {
    await env.DB.prepare('UPDATE customer_auth_otps SET consumed_at=? WHERE id=? AND consumed_at IS NULL').bind(now, challengeId).run();
    return response({ error: 'Could not send a WhatsApp verification code. Check that WhatsApp is available for this number and try again.' }, 502, env);
  }
  return response({ ok: true, challengeId, phone: '******' + phone.slice(-4), expiresIn: 300, message: 'A verification code has been sent on WhatsApp if this number can receive FreshWay messages.' }, 200, env);
}
async function verifyWhatsAppOtp(request, env) {
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  const phone = normalizedPhone(payload.phone);
  const challengeId = String(payload.challengeId || '').trim();
  const code = String(payload.code || '').trim();
  const name = String(payload.name || '').trim().slice(0, 120);
  if (!phone || !/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    return response({ error: 'Enter your mobile number and the 6-digit WhatsApp code.' }, 400, env);
  }
  if (!(await rateLimit(env, 'auth:whatsapp-otp:verify:phone:' + phone, 10)) ||
      !(await rateLimit(env, 'auth:whatsapp-otp:verify:ip:' + clientIp(request), 30))) return limited(env);
  const now = Math.floor(Date.now() / 1000);
  const challenge = await env.DB.prepare('SELECT id,phone,code_hash,expires_at,attempts,consumed_at FROM customer_auth_otps WHERE id=? AND phone=? LIMIT 1')
    .bind(challengeId, phone).first();
  if (!challenge || (challenge.consumed_at !== null && challenge.consumed_at !== undefined) ||
      Number(challenge.expires_at) <= now || Number(challenge.attempts) >= 5) {
    return response({ error: 'This verification code is invalid or expired. Request a new code.' }, 401, env);
  }
  const suppliedHash = await otpDigest(env, challengeId, phone, code);
  if (!constantTimeTextEqual(suppliedHash, challenge.code_hash)) {
    const attempts = Number(challenge.attempts) + 1;
    await env.DB.prepare('UPDATE customer_auth_otps SET attempts=?,consumed_at=CASE WHEN ?>=5 THEN ? ELSE consumed_at END WHERE id=? AND consumed_at IS NULL')
      .bind(attempts, attempts, now, challengeId).run();
    return response({ error: attempts >= 5 ? 'Too many incorrect codes. Request a new code.' : 'The verification code is incorrect.' }, attempts >= 5 ? 429 : 401, env);
  }
  const customer = await customerByPhone(env, phone);
  if (!customer?.id && !name) {
    return response({ ok: true, needsName: true, message: 'Enter your name to finish creating your FreshWay account.' }, 200, env);
  }
  const consumed = await env.DB.prepare('UPDATE customer_auth_otps SET consumed_at=? WHERE id=? AND phone=? AND consumed_at IS NULL AND expires_at>? AND attempts<5')
    .bind(now, challengeId, phone, now).run();
  if (Number(consumed?.meta?.changes || 0) !== 1) {
    return response({ error: 'This verification code has already been used or expired. Request a new code.' }, 401, env);
  }
  let customerId;
  if (customer?.id) {
    customerId = customer.id;
    if (!String(customer.name || '').trim() && name) {
      await env.DB.prepare("UPDATE customers SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (name IS NULL OR TRIM(name)='')")
        .bind(name, customerId).run();
    }
  } else {
    customerId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO customers (id,name,phone,whatsapp_opt_in,updated_at) VALUES (?,?,?,0,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN customers.name IS NULL OR TRIM(customers.name)=\'\' THEN excluded.name ELSE customers.name END, updated_at=CURRENT_TIMESTAMP')
      .bind(customerId, name, phone).run();
  }
  const refreshed = await env.DB.prepare('SELECT id,name,phone FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
  return withSession({
    ok: true, customerId, phone: '******' + phone.slice(-4),
    registeredPhone: refreshed?.phone || phone, name: refreshed?.name || name,
    registered: !customer?.id
  }, env, await signSession(env, customerId));
}
async function derivePasscode(passcode, saltHex) { const baseKey = await crypto.subtle.importKey('raw', enc(passcode), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytesFromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, baseKey, 256)); }
async function makePasscodeHash(passcode) { const salt = new Uint8Array(16); crypto.getRandomValues(salt); const saltHex = hex(salt); return { saltHex, hashHex: hex(await derivePasscode(passcode, saltHex)) }; }
async function verifyPasscode(passcode, saltHex, expectedHex) { if (!/^[0-9a-f]{32}$/i.test(saltHex || '') || !/^[0-9a-f]{64}$/i.test(expectedHex || '')) return false; const actual = await derivePasscode(passcode, saltHex), expected = bytesFromHex(expectedHex); let diff = 0; for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]; return diff === 0; }
async function customerByPhone(env, phone) { return env.DB.prepare('SELECT id,name,phone,passcode_salt,passcode_hash FROM customers WHERE phone=? LIMIT 1').bind(phone).first(); }
async function customerExists(env, id) { return !!(await env.DB.prepare('SELECT id FROM customers WHERE id=? LIMIT 1').bind(id).first()); }
function validPasscode(value) { return /^\d{6}$/.test(String(value || '')); }
async function register(request, env) { let payload = {}; try { payload = await request.json(); } catch (_) {} const phone = normalizedPhone(payload.phone), passcode = String(payload.passcode || ''), name = String(payload.name || '').trim().slice(0, 120); if (!phone || !validPasscode(passcode) || !name) return response({ error: 'Enter your name, a valid 10-digit mobile number and a 6-digit passcode.' }, 400, env); if (!(await rateLimit(env, `auth:register:phone:${phone}`, 5)) || !(await rateLimit(env, `auth:register:ip:${clientIp(request)}`, 20))) return limited(env); const existing = await customerByPhone(env, phone), customerId = existing?.id || crypto.randomUUID(); if (existing?.passcode_hash) return response({ error: 'This mobile number is already registered. Please log in with your 6-digit passcode.' }, 409, env); const { saltHex, hashHex } = await makePasscodeHash(passcode); await env.DB.prepare(`INSERT INTO customers (id,name,phone,passcode_salt,passcode_hash,whatsapp_opt_in,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,passcode_salt=excluded.passcode_salt,passcode_hash=excluded.passcode_hash,updated_at=CURRENT_TIMESTAMP`).bind(customerId, name, phone, saltHex, hashHex, payload.whatsappOptIn ? 1 : 0).run(); return withSession({ ok: true, customerId, phone: `******${phone.slice(-4)}`, registeredPhone: phone, name, registered: true }, env, await signSession(env, customerId)); }
async function login(request, env) { let payload = {}; try { payload = await request.json(); } catch (_) {} const phone = normalizedPhone(payload.phone), passcode = String(payload.passcode || ''); if (!phone || !validPasscode(passcode)) return response({ error: 'Enter your mobile number and 6-digit passcode.' }, 400, env); if (!(await rateLimit(env, `auth:login:phone:${phone}`, 5)) || !(await rateLimit(env, `auth:login:ip:${clientIp(request)}`, 20))) return limited(env); const customer = await customerByPhone(env, phone); if (!customer?.id || !customer.passcode_hash) return response({ error: 'This mobile number is not registered yet. Choose Create account.' }, 404, env); if (!(await verifyPasscode(passcode, customer.passcode_salt, customer.passcode_hash))) return response({ error: 'Incorrect mobile number or passcode.' }, 401, env); return withSession({ ok: true, customerId: customer.id, phone: `******${phone.slice(-4)}`, registeredPhone: phone, name: customer.name || '' }, env, await signSession(env, customer.id)); }
function twilioConfig(env) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(env.TWILIO_AUTH_TOKEN || '').trim();
  const serviceSid = String(env.TWILIO_VERIFY_SERVICE_SID || '').trim();
  return accountSid && authToken && /^VA[0-9a-f]{32}$/i.test(serviceSid) ? { accountSid, authToken, serviceSid } : null;
}
async function twilioVerify(env, operation, fields) {
  const config = twilioConfig(env);
  if (!config) throw new Error('PASSCODE_RECOVERY_NOT_CONFIGURED');
  const url = `https://verify.twilio.com/v2/Services/${config.serviceSid}/${operation}`;
  const auth = btoa(`${config.accountSid}:${config.authToken}`);
  const result = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    // Do not log a phone number or verification code. Twilio controls code expiry
    // and retry checks; client error messages remain intentionally generic.
    console.error('FreshWay passcode verification provider rejected a request.', result.status);
    throw new Error('PASSCODE_VERIFICATION_FAILED');
  }
  return data;
}
function recoveryUnavailable(env) {
  return response({ error: 'Passcode recovery is temporarily unavailable. Please contact FreshWay support.' }, 503, env);
}
async function startPasscodeReset(request, env) {
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  const phone = normalizedPhone(payload.phone);
  if (!phone) return response({ error: 'Enter the registered 10-digit mobile number.' }, 400, env);
  if (!twilioConfig(env)) return recoveryUnavailable(env);
  if (!(await rateLimit(env, `auth:reset:start:phone:${phone}`, 3)) ||
      !(await rateLimit(env, `auth:reset:start:ip:${clientIp(request)}`, 10))) return limited(env);
  const customer = await customerByPhone(env, phone);
  // Return the same response for unknown and known numbers to avoid account enumeration.
  if (customer?.id && customer.passcode_hash) {
    try {
      await twilioVerify(env, 'Verifications', { To: `+${phone}`, Channel: 'sms' });
    } catch (error) {
      if (error.message === 'PASSCODE_RECOVERY_NOT_CONFIGURED') return recoveryUnavailable(env);
      return response({ error: 'Could not send a verification code. Please wait and try again.' }, 502, env);
    }
  }
  return response({ ok: true, message: 'If this mobile is registered, a verification code has been sent.' }, 200, env);
}
async function completePasscodeReset(request, env) {
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  const phone = normalizedPhone(payload.phone);
  const code = String(payload.code || '').trim();
  const passcode = String(payload.passcode || '');
  if (!phone || !/^\d{6}$/.test(code) || !validPasscode(passcode)) {
    return response({ error: 'Enter your registered mobile number, 6-digit SMS code and new 6-digit passcode.' }, 400, env);
  }
  if (!twilioConfig(env)) return recoveryUnavailable(env);
  if (!(await rateLimit(env, `auth:reset:complete:phone:${phone}`, 5)) ||
      !(await rateLimit(env, `auth:reset:complete:ip:${clientIp(request)}`, 15))) return limited(env);
  const customer = await customerByPhone(env, phone);
  if (!customer?.id || !customer.passcode_hash) return response({ error: 'The verification code is invalid or expired. Request a new code.' }, 401, env);
  let verification;
  try {
    verification = await twilioVerify(env, 'VerificationCheck', { To: `+${phone}`, Code: code });
  } catch (error) {
    if (error.message === 'PASSCODE_RECOVERY_NOT_CONFIGURED') return recoveryUnavailable(env);
    return response({ error: 'The verification code could not be checked. Request a new code and try again.' }, 502, env);
  }
  if (verification.status !== 'approved') return response({ error: 'The verification code is invalid or expired. Request a new code.' }, 401, env);
  const { saltHex, hashHex } = await makePasscodeHash(passcode);
  await env.DB.prepare('UPDATE customers SET passcode_salt=?,passcode_hash=?,auth_version=COALESCE(auth_version,0)+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND phone=?')
    .bind(saltHex, hashHex, customer.id, phone).run();
  const refreshed = await env.DB.prepare('SELECT auth_version FROM customers WHERE id=? LIMIT 1').bind(customer.id).first();
  const version = Math.max(0, Number(refreshed?.auth_version || 0));
  const token = await signSession(env, customer.id);
  return withSession({
    ok: true, customerId: customer.id, phone: `******${phone.slice(-4)}`,
    registeredPhone: phone, name: customer.name || '', passcodeReset: true
  }, env, token);
}
async function updateCustomer(request, env) { const sessionId = await sessionCustomerId(request, env); if (!sessionId) return response({ error: 'Customer authentication required.' }, 401, env); let payload = {}; try { payload = await request.json(); } catch (_) {} if (String(payload.id || '').trim() !== sessionId) return response({ error: 'Customer identity does not match the signed-in account.' }, 409, env); await env.DB.prepare('UPDATE customers SET whatsapp_opt_in=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(payload.whatsappOptIn ? 1 : 0, sessionId).run(); return response({ ok: true, customerId: sessionId }, 200, env); }
async function customerOrdersFromSnapshots(request, env, customerId) {
  const { results } = await env.DB.prepare(`SELECT o.id,o.customer_name,o.customer_phone,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.payment_collected_at,
    c.name registered_name,c.phone registered_phone,
    COALESCE(s.recipient_name,a.recipient_name,o.customer_name) recipient_name,
    COALESCE(s.delivery_phone,a.delivery_phone) delivery_phone,
    COALESCE(s.house_flat,a.house) house,COALESCE(s.building,a.building) building,COALESCE(s.floor,a.floor) floor,
    COALESCE(s.street,a.street) street,COALESCE(s.area,a.area) area,COALESCE(s.locality,a.locality) locality,
    COALESCE(s.city,a.city) city,COALESCE(s.district,a.district) district,COALESCE(s.state,a.state) state,
    COALESCE(s.pincode,a.pincode) pincode,COALESCE(s.landmark,a.landmark) landmark,COALESCE(s.delivery_note,a.note) note,
    s.latitude,s.longitude,s.accuracy_meters,s.location_source,s.place_id,s.location_updated_at,
    i.invoice_number,i.document_type invoice_document_type,i.issue_date invoice_issue_date,
    oi.product_id,oi.name,oi.unit,oi.qty,oi.price,oi.line_total
    FROM orders o
    LEFT JOIN customers c ON c.id=o.customer_id
    LEFT JOIN order_address_snapshots s ON s.order_id=o.id
    LEFT JOIN addresses a ON a.id=o.address_id
    LEFT JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN invoices i ON i.order_id=o.id
    WHERE o.customer_id=? AND COALESCE(o.is_test_order,0)=0
    ORDER BY o.created_at DESC,oi.id ASC`).bind(customerId).all();
  const map = new Map();
  for (const row of results || []) {
    if (!map.has(row.id)) map.set(row.id, {
      id: row.id,
      customer: { name: row.registered_name || row.customer_name, phone: row.registered_phone || row.customer_phone },
      address: {
        house: row.house, building: row.building, floor: row.floor, street: row.street, area: row.area,
        locality: row.locality, city: row.city, district: row.district, state: row.state, pincode: row.pincode,
        landmark: row.landmark, note: row.note, recipientName: row.recipient_name || row.customer_name,
        deliveryPhone: row.delivery_phone || '', latitude: row.latitude, longitude: row.longitude,
        accuracyMeters: row.accuracy_meters, locationSource: row.location_source, placeId: row.place_id,
        locationUpdatedAt: row.location_updated_at
      },
      items: [], total: row.total, payment: row.payment_status, status: row.delivery_status,
      deliveryPlan: row.delivery_plan, createdAt: row.created_at, updatedAt: row.updated_at,
      paymentCollectedAt: row.payment_collected_at,
      invoice: row.invoice_number?{number:row.invoice_number,documentType:row.invoice_document_type,issuedAt:row.invoice_issue_date}:null
    });
    if (row.product_id) map.get(row.id).items.push({
      id: row.product_id, name: row.name, unit: row.unit, qty: row.qty, price: row.price, lineTotal: row.line_total
    });
  }
  return response({ orders: [...map.values()] }, 200, env);
}
async function protectedOrders(request, env, ctx) {
  const sessionId = await sessionCustomerId(request, env);
  if (!sessionId || !(await customerExists(env, sessionId))) return response({ error: 'Customer authentication required.' }, 401, env);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (String(url.searchParams.get('customerId') || '').trim() !== sessionId) {
      return response({ error: 'Customer identity does not match the signed-in account.' }, 403, env);
    }
    return customerOrdersFromSnapshots(request, env, sessionId);
  }
  if (request.method !== 'POST') return original.fetch(request, env, {});
  let payload = {};
  try { payload = await request.clone().json(); } catch (_) {}
  if (String(payload.customerId || '') !== sessionId) {
    return response({ error: 'Customer identity does not match the signed-in account.' }, 403, env);
  }
  const deliveryPhone = cleanPhone(payload.address?.deliveryPhone || payload.customer?.phone);
  if (!deliveryPhone || !/^\d{10}$/.test(deliveryPhone)) {
    return response({ error: 'Enter a valid 10-digit delivery contact number.' }, 400, env);
  }
  const registration = await env.DB.prepare('SELECT phone FROM customers WHERE id=? LIMIT 1').bind(sessionId).first();
  const registeredPhone = String(registration?.phone || '');
  if (!/^91\d{10}$/.test(registeredPhone)) {
    return response({ error: 'Customer registration phone is not configured.' }, 409, env);
  }
  // Identity always comes from the signed-in account. The delivery contact is an
  // order-specific field and is stored only in the immutable address snapshot.
  const address = { ...(payload.address || {}), deliveryPhone: `91${deliveryPhone}` };
  // The legacy order writer validates customer.phone as ten local digits. Keep the account identity canonical in D1 and restore its canonical value on the order row below.
  const forwarded = { ...payload, customer: { ...(payload.customer || {}), phone: registeredPhone.slice(2) }, address };
  const responseFromOriginal = await original.fetch(new Request(request, {
    method: 'POST', body: JSON.stringify(forwarded)
  }), env, ctx || {});
  if (!responseFromOriginal.ok) return responseFromOriginal;
  let result = {};
  try { result = await responseFromOriginal.clone().json(); } catch (_) {}
  if (result?.id) {
    try {
      await saveOrderSnapshot(env, String(result.id), address);
    } catch (error) {
      return response({ error: error.message || 'Could not save the final delivery address.' }, 500, env);
    }
    // Repair the legacy duplicated field too, so every new order row stores the
    // account mobile even if the underlying order writer changes its mapping.
    await env.DB.prepare('UPDATE orders SET customer_phone=? WHERE id=? AND customer_id=?')
      .bind(registeredPhone, String(result.id), sessionId).run();
  }
  return responseFromOriginal;
}
async function protectedPush(request, env) { const sessionId = await sessionCustomerId(request, env); if (!sessionId || !(await customerExists(env, sessionId))) return response({ error: 'Customer authentication required.' }, 401, env); let payload = {}; try { payload = await request.clone().json(); } catch (_) {} if (String(payload.customerId || '') !== sessionId) return response({ error: 'Customer identity does not match the signed-in account.' }, 403, env); return original.fetch(request, env, {}); }
export default { async fetch(request, env, ctx) { const url = new URL(request.url), requestOrigin = String(request.headers.get('Origin') || '').trim(), origins = corsOrigins(env), allowedOrigin = corsOrigin(env, requestOrigin), requestEnvironment = String(request.headers.get('X-Freshway-Environment') || '').trim().toLowerCase(), deploymentEnvironment = String(env.FRESHWAY_ENVIRONMENT || '').trim().toLowerCase(); if (requestEnvironment && deploymentEnvironment && requestEnvironment !== deploymentEnvironment) return response({ error: 'Environment mismatch.' }, 403, env); if (requestOrigin && !isAllowedOrigin(env, requestOrigin)) return response({ error: 'Origin not allowed.' }, 403, env); if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': allowedOrigin, 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'Content-Type,Authorization,X-Freshway-Admin-Token', 'access-control-allow-credentials': 'true' } }); if (url.pathname === '/api/auth/otp/start' && request.method === 'POST') { try { return await startWhatsAppOtp(request, env); } catch (error) { console.error('FreshWay WhatsApp OTP start failed:', error?.message || error); return response({ error: 'Could not start WhatsApp verification. Please try again.' }, 500, env); } } if (url.pathname === '/api/auth/otp/verify' && request.method === 'POST') { try { return await verifyWhatsAppOtp(request, env); } catch (error) { console.error('FreshWay WhatsApp OTP verification failed:', error?.message || error); return response({ error: 'Could not verify this code. Please request a new one.' }, 500, env); } } if (['/api/auth/register','/api/auth/login','/api/auth/passcode-reset/start','/api/auth/passcode-reset/complete'].includes(url.pathname) && request.method === 'POST') return response({ error: 'FreshWay customer access uses WhatsApp OTP. Request a new verification code.' }, 410, env); if (url.pathname === '/api/auth/session' && request.method === 'GET') { const id = await sessionCustomerId(request, env); if (!id || !(await customerExists(env, id))) return response({ error: 'Customer authentication required.' }, 401, env); const row = await env.DB.prepare('SELECT id,name,phone FROM customers WHERE id=? LIMIT 1').bind(id).first(); return response({ ok: true, customerId: id, name: row?.name || '', phone: row?.phone ? `******${String(row.phone).slice(-4)}` : '', registeredPhone: row?.phone || '' }, 200, env); } if (url.pathname === '/api/auth/logout' && request.method === 'POST') return clearSession(env); if (url.pathname === '/api/auth/register' && request.method === 'POST') { try { return await register(request, env); } catch (error) { return response({ error: error.message || 'Could not create your account.' }, 500, env); } } if (url.pathname === '/api/auth/login' && request.method === 'POST') { try { return await login(request, env); } catch (error) { return response({ error: error.message || 'Could not sign you in.' }, 500, env); } } if (url.pathname === '/api/auth/passcode-reset/start' && request.method === 'POST') { try { return await startPasscodeReset(request, env); } catch (error) { console.error('FreshWay passcode reset start failed:', error?.message || error); return response({ error: 'Could not start passcode recovery. Please try again.' }, 500, env); } } if (url.pathname === '/api/auth/passcode-reset/complete' && request.method === 'POST') { try { return await completePasscodeReset(request, env); } catch (error) { console.error('FreshWay passcode reset completion failed:', error?.message || error); return response({ error: 'Could not reset your passcode. Please try again.' }, 500, env); } } if (url.pathname === '/api/customers/register' && request.method === 'POST') return updateCustomer(request, env); const invoiceMatch=url.pathname.match(/^\/api\/orders\/([^/]+)\/invoice$/);if(invoiceMatch&&request.method==='GET'){try{return await customerInvoice(request,env,invoiceMatch[1])}catch(error){console.error('FreshWay customer invoice download failed:',error?.message||error);return response({error:'Could not download this invoice.'},500,env,{'access-control-allow-origin':corsOrigin(env,request.headers.get('Origin')||'')})}}if (url.pathname === '/api/orders' && ['GET','POST'].includes(request.method)) return protectedOrders(request, env, ctx); if (url.pathname === '/api/push/subscribe' && request.method === 'POST') return protectedPush(request, env); if (url.pathname === '/api/addresses' && request.method === 'GET') { const id=await sessionCustomerId(request,env); if(!id||!(await customerExists(env,id)))return response({error:'Customer authentication required.'},401,env); return handleAddress(request,env,id,'list'); } if (url.pathname === '/api/addresses' && request.method === 'POST') { const id=await sessionCustomerId(request,env); if(!id||!(await customerExists(env,id)))return response({error:'Customer authentication required.'},401,env); return handleAddress(request,env,id,'create'); } {
      const addressMatch = url.pathname.match(/^\/api\/addresses\/(\d+)(?:\/delete)?\/?$/);
      if (addressMatch) {
        const id=await sessionCustomerId(request,env);
        if(!id||!(await customerExists(env,id)))return response({error:'Customer authentication required.'},401,env);
        const isDeleteAlias = /\/delete\/?$/.test(url.pathname);
        if (isDeleteAlias) {
          if (request.method !== 'POST') return response({ error:'Method not allowed.' },405,env);
          const deleteRequest = new Request(new URL(`/api/addresses/${addressMatch[1]}`,url), { method:'DELETE', headers:request.headers });
          return handleAddress(deleteRequest,env,id,'delete');
        }
        const action=request.method==='PATCH'?'update':request.method==='DELETE'?'delete':'update';
        return handleAddress(request,env,id,action);
      }
    } return original.fetch(request,env,ctx); } };