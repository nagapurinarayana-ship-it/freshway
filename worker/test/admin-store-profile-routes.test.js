import test from 'node:test';
import assert from 'node:assert/strict';
import adminAuth from '../src/admin-auth.js';

const SECRET = 'test-only-admin-session-secret';
const encoder = new TextEncoder();
const toHex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

async function sessionCookie() {
  const issued = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(issued));
  return `__Host-freshway-admin-session=${issued}.${toHex(signature)}`;
}

function setup() {
  let stored = {
    store_name: 'FreshWay',
    about: 'Cold-pressed oils and rice',
    phone: '9876543210',
    whatsapp: '9876543210',
    email: 'hello@example.test',
    address: 'Mancherial, Telangana',
    shop_latitude: 17.6082,
    shop_longitude: 79.1091,
    business_hours: '9 AM–7 PM',
    delivery_info: 'Local delivery',
    share_title: 'FreshWay',
    share_description: 'Fresh essentials delivered locally'
  };
  const env = {
    ADMIN_SESSION_SECRET: SECRET,
    APP_ORIGIN: 'https://fwcoldpressed.in',
    APP_ORIGINS: 'https://fwcoldpressed.in',
    DB: {
      prepare(sql) {
        if (sql.startsWith('SELECT store_name,about,phone,whatsapp,email,address,shop_latitude,shop_longitude')) {
          return { async first() { return { ...stored }; } };
        }
        if (sql.startsWith('INSERT INTO store_profile ')) {
          return {
            bind(...values) {
              return {
                async run() {
                  const [storeName, about, phone, whatsapp, email, address, latitude, longitude, hours, delivery, shareTitle, shareDescription] = values;
                  stored = {
                    store_name: storeName, about, phone, whatsapp, email, address,
                    shop_latitude: latitude, shop_longitude: longitude,
                    business_hours: hours, delivery_info: delivery,
                    share_title: shareTitle, share_description: shareDescription
                  };
                  return { success: true, meta: { changes: 1 } };
                }
              };
            }
          };
        }
        throw new Error('Unexpected SQL in Store Profile route test: ' + sql);
      }
    }
  };
  return { env, stored: () => ({ ...stored }) };
}

async function call(path, { method = 'GET', cookie, body } = {}, env) {
  const headers = new Headers({ Accept: 'application/json' });
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return adminAuth.fetch(new Request('https://fwcoldpressed.in' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }), env, {});
}

test('Owner Store Profile routes reject unauthenticated requests', async () => {
  const { env } = setup();
  const response = await call('/api/admin/store-profile', {}, env);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Unauthorized/i);
});

test('Owner Store Profile loads saved data and partial updates preserve other fields and the shop pin', async () => {
  const { env, stored } = setup();
  const cookie = await sessionCookie();

  const loaded = await call('/api/admin/store-profile', { cookie }, env);
  assert.equal(loaded.status, 200);
  const initial = await loaded.json();
  assert.equal(initial.storeProfile.storeName, 'FreshWay');
  assert.equal(initial.storeProfile.about, 'Cold-pressed oils and rice');
  assert.equal(initial.storeProfile.address, 'Mancherial, Telangana');
  assert.equal(initial.storeProfile.shopLatitude, 17.6082);
  assert.equal(initial.storeProfile.shopLongitude, 79.1091);

  const saved = await call('/api/admin/store-profile', {
    method: 'PATCH', cookie, body: { about: 'Updated business story' }
  }, env);
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.storeProfile.about, 'Updated business story');
  assert.equal(result.storeProfile.address, 'Mancherial, Telangana');
  assert.equal(result.storeProfile.phone, '9876543210');
  assert.equal(result.storeProfile.businessHours, '9 AM–7 PM');
  assert.equal(result.storeProfile.shopLatitude, 17.6082);
  assert.equal(result.storeProfile.shopLongitude, 79.1091);
  assert.equal(stored().about, 'Updated business story');
});
