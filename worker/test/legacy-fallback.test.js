import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const addressFixSource = readFileSync(new URL('../../address-fix.js', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

function installAddressFix(responder) {
  const calls = [];
  const window = {
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      return responder({ input: String(input), init, calls });
    }
  };

  vm.runInNewContext(addressFixSource, {
    window,
    location: { origin: 'https://freshway.test' },
    URL,
    Response,
    JSON,
    String,
    Number
  }, { filename: 'address-fix.js' });

  return { fetch: window.fetch, calls };
}

test('address DELETE fallback reports success only after confirming the address is absent', async () => {
  const harness = installAddressFix(({ input, calls }) => {
    if (calls.length === 1) return json({ error: 'Address not found.' }, 404);
    assert.equal(input, '/api/addresses');
    return json({ addresses: [{ id: 456 }] });
  });

  const response = await harness.fetch('/api/addresses/123', { method: 'DELETE' });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.alreadyDeleted, true);
  assert.equal(harness.calls.length, 2);
});

test('address DELETE fallback preserves 404 when the requested address still exists', async () => {
  const harness = installAddressFix(({ calls }) => calls.length === 1
    ? json({ error: 'Address not found.' }, 404)
    : json({ addresses: [{ id: 123 }, { id: 456 }] }));

  const response = await harness.fetch('/api/addresses/123', { method: 'DELETE' });
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.error, 'Address not found.');
  assert.equal(data.alreadyDeleted, undefined);
});

test('address DELETE fallback preserves 404 when the follow-up list request fails', async () => {
  const harness = installAddressFix(({ calls }) => {
    if (calls.length === 1) return json({ error: 'Address not found.' }, 404);
    throw new Error('Temporary network failure');
  });

  const response = await harness.fetch('/api/addresses/123', { method: 'DELETE' });
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.error, 'Address not found.');
});

test('address collection DELETE is never incorrectly reported as an already-deleted item', async () => {
  const harness = installAddressFix(() => json({ error: 'Not found.' }, 404));
  const response = await harness.fetch('/api/addresses', { method: 'DELETE' });

  assert.equal(response.status, 404);
  assert.equal(harness.calls.length, 1);
});

test('address script cache-busting version matches the service-worker shell entry', () => {
  const htmlVersion = indexHtml.match(/src="address-fix\.js\?v=([^"]+)"/)?.[1];
  const shellVersion = serviceWorkerSource.match(/['"]\/address-fix\.js\?v=([^'"]+)['"]/)?.[1];

  assert.ok(htmlVersion, 'index.html should version address-fix.js');
  assert.ok(shellVersion, 'the service-worker shell should cache address-fix.js');
  assert.equal(htmlVersion, shellVersion);
});

test('owner lifecycle script cache-busting version matches the service-worker shell entry', () => {
  const htmlVersion = adminHtml.match(/src="owner-lifecycle\.js\?v=([^"]+)"/)?.[1];
  const shellVersion = serviceWorkerSource.match(/['"]\/owner-lifecycle\.js\?v=([^'"]+)['"]/)?.[1];

  assert.ok(htmlVersion, 'admin.html should version owner-lifecycle.js');
  assert.ok(shellVersion, 'the service-worker shell should cache owner-lifecycle.js');
  assert.equal(htmlVersion, shellVersion);
  assert.doesNotMatch(serviceWorkerSource, /20260909-refresh-v3/, 'no stale owner-lifecycle URL rewrite should remain');
});

test('service worker loads online documents and executable code from the network first, with cache fallback', () => {
  assert.match(serviceWorkerSource, /if \(isNavigation && \['\/', '\/index\.html', '\/admin\.html'\]\.includes\(url\.pathname\)\)/);
  assert.match(serviceWorkerSource, /const freshCode = \['script','style'\]\.includes\(destination\)/);
  assert.match(serviceWorkerSource, /freshCode \? new Request\(event\.request, \{ cache: 'no-store' \}\)/);
  assert.match(serviceWorkerSource, /const cached = freshCode \? null : await cache\.match\(event\.request\)/);
  assert.match(serviceWorkerSource, /return \(await cache\.match\(event\.request\)\) \|\| Response\.error\(\)/);
  assert.match(serviceWorkerSource, /const CACHE = 'freshway-v45'/);
});
