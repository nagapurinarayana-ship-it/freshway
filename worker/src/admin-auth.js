import original from './secure-index.js';

const COOKIE = 'freshway-admin-session';
const MAX_AGE = 60 * 60 * 8;
const WINDOW = 10 * 60;
const LIMIT = 10;
const enc = value => new TextEncoder().encode(value);
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const origin = env => env.APP_ORIGIN && env.APP_ORIGIN !== 'https://YOUR-FRESHWAY-DOMAIN' ? env.APP_ORIGIN : '*';
const ip = request => String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim().slice(0, 80) || 'unknown';

async function key(env) {
  const secret = String(env.ADMIN_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('Admin session signing is not configured.');
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function sign(env) { const issued=Math.floor(Date.now()/1000); const payload=String(issued); const signature=await crypto.subtle.sign('HMAC',await key(env),enc(payload)); return `${payload}.${hex(new Uint8Array(signature))}`; }
function cookieValue(request) { const raw=request.headers.get('Cookie')||''; const match=raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); return match?match[1]:''; }
async function validSession(request,env) { const raw=cookieValue(request); if(!raw)return false; const [issuedRaw,signatureHex]=raw.split('.'); const issued=Number(issuedRaw); if(!Number.isSafeInteger(issued)||!/^[0-9a-f]{64}$/i.test(signatureHex||''))return false; const now=Math.floor(Date.now()/1000); if(issued<now-MAX_AGE||issued>now+60)return false; try { const expected=new Uint8Array(await crypto.subtle.sign('HMAC',await key(env),enc(issuedRaw))); const actual=new Uint8Array((signatureHex.match(/../g)||[]).map(x=>parseInt(x,16))); if(actual.length!==expected.length)return false; let diff=0; for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i]; return diff===0; } catch(_){return false;} }
async function rateLimit(env,request) { const keyName=`admin:login:${ip(request)}`; const start=Math.floor(Date.now()/1000/WINDOW)*WINDOW; await env.DB.prepare(`INSERT INTO auth_rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_rate_limits.window_start=? THEN auth_rate_limits.count+1 ELSE 1 END, window_start=?`).bind(keyName,start,start,start).run(); const row=await env.DB.prepare('SELECT count,window_start FROM auth_rate_limits WHERE key=?').bind(keyName).first(); return !!row&&row.window_start===start&&Number(row.count)<=LIMIT; }
function response(data,status,env,extra={}) { return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin(env),'access-control-allow-credentials':'true','cache-control':'private, no-store',...extra}}); }
function withCookie(res,token) { const headers=new Headers(res.headers); headers.append('Set-Cookie',`${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`); headers.set('Cache-Control','private, no-store'); headers.set('Access-Control-Allow-Credentials','true'); return new Response(res.body,{status:res.status,statusText:res.statusText,headers}); }

export default { async fetch(request,env,ctx) {
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin(env),'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'Content-Type,Authorization,X-Freshway-Admin-Token','access-control-allow-credentials':'true'}});
  if(url.pathname==='/api/admin/login'&&request.method==='POST'){ if(!(await rateLimit(env,request)))return response({error:'Too many login attempts. Please try again later.'},429,env,{'retry-after':'600'}); let payload={}; try{payload=await request.json()}catch(_){} const expected=String(env.ADMIN_TOKEN||'').trim(); const supplied=String(payload.token||'').trim(); if(!expected||!supplied||supplied!==expected)return response({error:'Unauthorized'},401,env); return withCookie(response({ok:true},200,env),await sign(env)); }
  if(url.pathname==='/api/admin/logout'&&request.method==='POST'){const res=response({ok:true},200,env);const headers=new Headers(res.headers);headers.append('Set-Cookie',`${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);return new Response(res.body,{status:res.status,headers});}
  if(url.pathname.startsWith('/api/admin/')||url.pathname==='/api/notifications/broadcast'){if(!(await validSession(request,env)))return response({error:'Unauthorized'},401,env,{'www-authenticate':'Session'});const headers=new Headers(request.headers);headers.set('Authorization',`Bearer ${String(env.ADMIN_TOKEN||'').trim()}`);headers.delete('X-Freshway-Admin-Token');return original.fetch(new Request(request,{headers}),env,ctx);}
  return original.fetch(request,env,ctx);
} };