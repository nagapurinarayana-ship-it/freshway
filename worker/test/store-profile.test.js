import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STORE_PROFILE, sanitizeStoreProfile } from '../src/store-profile.js';

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
