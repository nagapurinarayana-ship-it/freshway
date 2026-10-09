import assert from 'node:assert/strict';
import { onRequest } from './admin.html.js';

const html = '<!doctype html><html><head><title>FreshWay — Owner</title></head><body>Owner dashboard</body></html>';

function makeContext(method = 'GET') {
  return {
    request: new Request('https://freshway-f32.pages.dev/admin.html', { method }),
    env: {
      ASSETS: {
        fetch: async request => {
          assert.equal(new URL(request.url).pathname, '/admin.html');
          assert.equal(request.method, 'GET');
          return new Response(html, {
            status: 200,
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
}

for (const method of ['GET', 'HEAD']) {
  const response = await onRequest(makeContext(method));
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

console.log('Owner HTML no-store cache policy regression contract OK');
