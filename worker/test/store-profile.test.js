import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STORE_PROFILE, sanitizeStoreProfile, getStoreProfile, updateStoreProfile } from '../src/store-profile.js';

const savedPin = { shopLatitude: 17.6082, shopLongitude: 79.1091 };

test('store profile keeps WhatsApp sharing fields separate from SEO', () => {
  const profile = sanitizeStoreProfile({
    shareTitle: 'FreshWay WhatsApp',
    shareDescription: 'Order fresh groceries directly from FreshWay.'
  });
  assert.equal(profile.shareTitle, 'FreshWay WhatsApp');
  assert.equal(profile.shareDescription, 'Order fresh groceries directly from FreshWay.');
  assert.equal(profile.storeName, DEFAULT_STORE_PROFILE.storeName);
});

test('store profile clamps editable content', () => {
  const profile = sanitizeStoreProfile({
    storeName: 'x'.repeat(500),
    about: 'a'.repeat(5000),
    shareDescription: 'b'.repeat(500)
  });
  assert.equal(profile.storeName.length, 120);
  assert.equal(profile.about.length, 4000);
  assert.equal(profile.shareDescription.length, 300);
});

test('shop map pin accepts valid numeric coordinates and normalizes strings', () => {
  const profile = sanitizeStoreProfile({ shopLatitude: '17.6082', shopLongitude: '79.1091' });
  assert.equal(profile.shopLatitude, 17.6082);
  assert.equal(profile.shopLongitude, 79.1091);
});

test('invalid or half-provided coordinates cannot overwrite an existing confirmed shop pin', () => {
  for (const payload of [
    { shopLatitude: 999, shopLongitude: 79.1 },
    { shopLatitude: 17.6 },
    { shopLatitude: 'bad', shopLongitude: 79.1 },
    { shopLatitude: 0, shopLongitude: 0 }
  ]) {
    const profile = sanitizeStoreProfile(payload, { ...DEFAULT_STORE_PROFILE, ...savedPin });
    assert.equal(profile.shopLatitude, savedPin.shopLatitude);
    assert.equal(profile.shopLongitude, savedPin.shopLongitude);
  }
});

test('older Owner clients that omit coordinate fields preserve the existing shop pin', () => {
  const profile = sanitizeStoreProfile({ address: 'Mancherial' }, { ...DEFAULT_STORE_PROFILE, ...savedPin });
  assert.equal(profile.address, 'Mancherial');
  assert.equal(profile.shopLatitude, savedPin.shopLatitude);
  assert.equal(profile.shopLongitude, savedPin.shopLongitude);
});

test('explicitly clearing both shop coordinates removes the saved pin', () => {
  const profile = sanitizeStoreProfile(
    { shopLatitude: null, shopLongitude: null },
    { ...DEFAULT_STORE_PROFILE, ...savedPin }
  );
  assert.equal(profile.shopLatitude, null);
  assert.equal(profile.shopLongitude, null);
});

test('store profile reads the persisted shop coordinates', async () => {
  const row = {
    store_name: 'FreshWay',
    about: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: 'Mancherial',
    shop_latitude: savedPin.shopLatitude,
    shop_longitude: savedPin.shopLongitude,
    business_hours: '',
    delivery_info: '',
    share_title: DEFAULT_STORE_PROFILE.shareTitle,
    share_description: DEFAULT_STORE_PROFILE.shareDescription
  };
  const env = { DB: { prepare(sql) {
    assert.match(sql, /SELECT store_name,about,phone,whatsapp,email,address,shop_latitude,shop_longitude/);
    return { async first() { return row; } };
  } } };
  const profile = await getStoreProfile(env);
  assert.equal(profile.shopLatitude, savedPin.shopLatitude);
  assert.equal(profile.shopLongitude, savedPin.shopLongitude);
});

test('store profile writes the shop coordinate pair without disturbing address fields', async () => {
  let stored = {
    store_name: 'FreshWay',
    about: 'About text',
    phone: '',
    whatsapp: '',
    email: '',
    address: 'Mancherial',
    shop_latitude: savedPin.shopLatitude,
    shop_longitude: savedPin.shopLongitude,
    business_hours: 'Weekdays',
    delivery_info: 'Local delivery',
    share_title: DEFAULT_STORE_PROFILE.shareTitle,
    share_description: DEFAULT_STORE_PROFILE.shareDescription
  };
  let insertSql = '';
  let boundValues = [];
  const env = { DB: { prepare(sql) {
    if (sql.startsWith('SELECT ')) return { async first() { return stored; } };
    insertSql = sql;
    return { bind(...values) {
      boundValues = values;
      return { async run() {
        const [
          storeName, about, phone, whatsapp, email, address,
          shopLatitude, shopLongitude, businessHours, deliveryInfo, shareTitle, shareDescription
        ] = values;
        stored = {
          store_name: storeName, about, phone, whatsapp, email, address,
          shop_latitude: shopLatitude, shop_longitude: shopLongitude,
          business_hours: businessHours, delivery_info: deliveryInfo,
          share_title: shareTitle, share_description: shareDescription
        };
        return { success: true };
      } };
    } };
  } } };
  const profile = await updateStoreProfile(env, { address: 'Mancherial, Telangana', shopLatitude: 17.611, shopLongitude: 79.112 });
  assert.match(insertSql, /shop_latitude,shop_longitude/);
  assert.equal(boundValues.length, 12);
  assert.equal(profile.address, 'Mancherial, Telangana');
  assert.equal(profile.shopLatitude, 17.611);
  assert.equal(profile.shopLongitude, 79.112);
  assert.equal(stored.about, 'About text');
  assert.equal(stored.business_hours, 'Weekdays');
  assert.equal(stored.delivery_info, 'Local delivery');
});
