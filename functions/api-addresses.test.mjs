import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const functionPath = fileURLToPath(new URL('./api/[[path]].js', import.meta.url));
const source = readFileSync(functionPath, 'utf8');
const module = await import(
  `data:text/javascript;base64,${Buffer.from(source + '\nexport { onRequest };').toString('base64')}`
);
const { onRequest } = module;

test('address Pages proxy retries JSON through the direct Worker when the binding returns HTML', async () => {
  let bindingCalls = 0;
  let fallbackCalls = 0;
  let fallbackRequest = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async request => {
    fallbackCalls++;
    fallbackRequest = request;
    return new Response(JSON.stringify({ addresses: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  };

  try {
    const response = await onRequest({
      env: {
        FRESHWAY_API: {
          fetch: async () => {
            bindingCalls++;
            return new Response('<!doctype html><html><body>FreshWay</body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html; charset=UTF-8' }
            });
          }
        }
      },
      request: new Request('https://freshway-f32.pages.dev/api/addresses', {
        headers: {
          Origin: 'https://freshway-f32.pages.dev',
          Cookie: 'freshway-customer-session=fixture'
        }
      })
    });

    assert.equal(bindingCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/json/i);
    assert.deepEqual(await response.json(), { addresses: [] });
    assert.equal(fallbackRequest.headers.get('Cookie'), 'freshway-customer-session=fixture');
    assert.equal(fallbackRequest.headers.get('Accept'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('address Pages proxy replays address mutation bodies during HTML fallback', async () => {
  let fallbackRequest = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async request => {
    fallbackRequest = request.clone();
    return new Response(JSON.stringify({ ok: true, addresses: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const response = await onRequest({
      env: {
        FRESHWAY_API: {
          fetch: async () => new Response('<html>broken</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
      },
      request: new Request('https://freshway-f32.pages.dev/api/addresses/12/default', {
        method: 'PATCH',
        headers: {
          Origin: 'https://freshway-f32.pages.dev',
          Cookie: 'freshway-customer-session=fixture',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: 12 })
      })
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/json/i);
    assert.deepEqual(await response.json(), { ok: true, addresses: [] });
    assert.equal(fallbackRequest.method, 'PATCH');
    assert.equal(fallbackRequest.url, 'https://freshway-api.all-in-one-all.workers.dev/api/addresses/12');
    assert.deepEqual(await fallbackRequest.json(), { id: 12, default: true, isDefault: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('address Pages proxy never exposes an HTML fallback as an address response', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response('<html>broken</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });

  try {
    const response = await onRequest({
      env: {},
      request: new Request('https://freshway-f32.pages.dev/api/addresses')
    });
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type') || '', /^application\/json/i);
    assert.deepEqual(await response.json(), {
      error: 'Address service returned an unexpected response.'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
