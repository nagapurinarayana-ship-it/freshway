import assert from 'node:assert/strict';
import { onRequest } from './admin.html.js';

const html = '<!doctype html><html><head><title>FreshWay — Owner</title></head><body>Owner dashboard</body></html>';

function makeContext({
  method = 'GET',
  assetStatus = 200,
  requestHeaders = {}
} = {}) {
  let assetRequestCount = 0;
  const context = {
    request: new Request('https://freshway-f32.pages.dev/admin.html?ignored=1', {
      method,
      headers: requestHeaders
    }),
    env: {
      ASSETS: {
        fetch: async request => {
          assetRequestCount++;
          assert.equal(new URL(request.url).pathname, '/admin', 'ASSETS fetch must use the canonical pretty path for admin.html');
          assert.equal(new URL(request.url).search, '');
          assert.equal(request.method, 'GET');
          assert.equal(request.headers.has('if-none-match'), false);
          assert.equal(request.headers.has('if-modified-since'), false);
          assert.equal(request.headers.has('cache-control'), false);
          return new Response(assetStatus === 200 ? html : 'Owner asset unavailable', {
            status: assetStatus,
            headers: {
              'content-type': 'text/html; charset=UTF-8',
              'cache-control': 'public, max-age=0, must-revalidate',
              'x-robots-tag': 'noindex, nofollow'
            }
          });
        }
      }
    },
    next: async () => new Response('next')
  };
  return { context, getAssetRequestCount: () => assetRequestCount };
}

for (const method of ['GET', 'HEAD']) {
  const { context } = makeContext({
    method,
    requestHeaders: {
      'if-none-match': '"stale-validator"',
      'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      'cache-control': 'max-age=86400'
    }
  });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(response.headers.get('content-type') || '', /text\/html/i);
  if (method === 'GET') {
    assert.match(await response.text(), /Owner dashboard/);
  } else {
    assert.equal(await response.text(), '');
  }
}

{
  const { context } = makeContext({ assetStatus: 404 });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
  assert.match(await response.text(), /Owner asset unavailable/);
}

{
  const { context, getAssetRequestCount } = makeContext({ method: 'POST' });
  const response = await onRequest(context);
  assert.equal(await response.text(), 'next');
  assert.equal(getAssetRequestCount(), 0, 'unsupported methods must pass through without fetching the asset');
}

console.log('Owner HTML cache policy, conditional-request, method and error-response tests passed');
