import { test, expect } from '@playwright/test';

const address = { latitude: 17.386, longitude: 78.487 };

test('nearest active store is out of stock, so the next eligible store fulfils the basket', async ({ request }) => {
  const response = await request.post('/api/delivery/availability', {
    data: { address, items: [{ id: 'test-rice', qty: 1 }] }
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.available).toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store).toMatchObject({ id: 'store-fallback', name: 'Fallback Store' });
  expect(result.store.id).not.toBe('store-nearest');
});

test('basket is not split when separate stores each have only part of the basket', async ({ request }) => {
  const response = await request.post('/api/delivery/availability', {
    data: { address, items: [{ id: 'test-oil', qty: 1 }, { id: 'test-rice', qty: 1 }] }
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('OUT_OF_STOCK');
});

test('inactive store stock is never used for new delivery availability', async ({ request }) => {
  const response = await request.post('/api/delivery/availability', {
    data: { address: { latitude: 17.405, longitude: 78.505 }, items: [{ id: 'test-oil', qty: 1 }] }
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('OUT_OF_STOCK');
});
