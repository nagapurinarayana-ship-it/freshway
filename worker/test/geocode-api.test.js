import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReverseGeocode } from '../src/geocode-api.js';

class MemoryCache {
  constructor() { this.items = new Map(); }
  async match(request) {
    const response = this.items.get(request.url);
    return response ? response.clone() : undefined;
  }
  async put(request, response) { this.items.set(request.url, response.clone()); }
}

const request = (query = '?lat=17.4948&lon=78.3996', method = 'GET') =>
  new Request('https://fwcoldpressed.in/api/geocode/reverse' + query, { method });

test('reverse geocoder validates coordinates before calling the provider', async () => {
  let calls = 0;
  const response = await handleReverseGeocode(request('?lat=95&lon=78.4'), {
    fetcher: async () => { calls++; throw new Error('must not call provider'); }
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('reverse geocoder uses address-only results and caches successful responses', async () => {
  let calls = 0, waitCount = 0;
  const cache = new MemoryCache();
  const fetcher = async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'nominatim.openstreetmap.org');
    assert.equal(parsed.searchParams.get('layer'), 'address');
    assert.match(options.headers['User-Agent'], /FreshWay/);
    return new Response(JSON.stringify({ place_id: 1, address: { road: 'New Road', postcode: '500072' } }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  const opts = { origin: 'https://fwcoldpressed.in', fetcher, cache, waitUntil: promise => { waitCount++; promise.catch(() => {}); } };
  const first = await handleReverseGeocode(request(), opts);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /max-age=3600/);
  assert.equal((await first.json()).address.road, 'New Road');
  await new Promise(resolve => setImmediate(resolve));
  const second = await handleReverseGeocode(request(), opts);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).address.postcode, '500072');
  assert.equal(calls, 1, 'repeat pin lookup should be served from cache');
  assert.equal(waitCount, 1);
});

test('provider errors and address-less responses are not cached as good data', async () => {
  const cache = new MemoryCache();
  const failed = await handleReverseGeocode(request(), {
    cache,
    fetcher: async () => new Response('busy', { status: 429 })
  });
  assert.equal(failed.status, 502);
  const empty = await handleReverseGeocode(request(), {
    cache,
    fetcher: async () => new Response(JSON.stringify({ display_name: 'No address object' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
  });
  assert.equal(empty.status, 502);
});
