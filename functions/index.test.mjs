import assert from 'node:assert/strict';
import { onRequest } from './index.js';

const html = `<!doctype html><html><head>
<meta property="og:title" content="FreshWay">
<meta name="twitter:title" content="FreshWay">
<meta property="og:description" content="Fresh groceries">
<meta name="twitter:description" content="Fresh groceries">
</head><body>FreshWay</body></html>`;

function makeContext(method = 'GET') {
  return {
    request: new Request('https://freshway-f32.pages.dev/', { method }),
    env: {
      ASSETS: {
        fetch: async request => {
          assert.equal(new URL(request.url).pathname, '/', 'ASSETS fetch must use the canonical root path for index.html');
          return new Response(html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=UTF-8',
            'cache-control': 'no-store, max-age=0, must-revalidate',
            etag: '"asset-etag"'
          }
        });
        }
      },
      FRESHWAY_API: {
        fetch: async request => {
          assert.equal(new URL(request.url).pathname, '/api/store-profile');
          return new Response(JSON.stringify({
            storeProfile: {
              shareTitle: 'FreshWay store sharing title',
              shareDescription: 'FreshWay store sharing description'
            }
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          });
        }
      }
    },
    next: async () => new Response('next')
  };
}

for (const method of ['GET', 'HEAD']) {
  const response = await onRequest(makeContext(method));
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('cache-control'),
    'no-store, max-age=0, must-revalidate',
    `homepage ${method} with store-sharing metadata must not be edge/browser cached`
  );
  assert.match(response.headers.get('content-type') || '', /text\/html/i);
  if (method === 'GET') {
    const body = await response.text();
    assert.match(body, /FreshWay store sharing title/);
    assert.match(body, /FreshWay store sharing description/);
  } else {
    assert.equal(await response.text(), '');
  }
}

console.log('Homepage dynamic metadata cache policy regression contract OK');
