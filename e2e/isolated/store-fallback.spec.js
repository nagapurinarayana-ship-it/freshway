import { test, expect } from '@playwright/test';

const address = { latitude: 17.385, longitude: 78.4867 };

test('falls back from the nearest active store with no stock to the next-nearest stocked store', async ({ request }) => {
  const response = await request.post('/api/delivery/availability', {
    data: { address, items: [{ id: 'rice-test', qty: 1 }] }
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.available).toBe(true);
  expect(result.code).toBe('AVAILABLE');
  expect(result.store.id).toBe('store-next');
  expect(result.store.name).toBe('Next Nearest Store');
  expect(result.store.distanceKm).toBeGreaterThan(1);
  expect(result.store.distanceKm).toBeLessThan(1.2);
});

test('does not split a basket when each store has only part of the requested stock', async ({ request }) => {
  const response = await request.post('/api/delivery/availability', {
    data: {
      address,
      items: [
        { id: 'rice-test', qty: 1 },
        { id: 'oil-test', qty: 1 }
      ]
    }
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('OUT_OF_STOCK');
});

test('does not use stock from an inactive store for new delivery availability', async ({ request }) => {
  const response = await request.post('/api/delivery/availability', {
    data: { address, items: [{ id: 'inactive-only-test', qty: 1 }] }
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.available).toBe(false);
  expect(result.code).toBe('OUT_OF_STOCK');
});
