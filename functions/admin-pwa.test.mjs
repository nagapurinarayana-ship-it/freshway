import assert from 'node:assert/strict';
import { onRequest } from './admin/[[path]].js';

const html = '<!doctype html><html><head><title>FreshWay — Owner</title></head><body><link href="admin.css?v=1"><script src="admin.js?v=2"></script><a href="#overview">Home</a></body></html>';

function makeContext(path, method = 'GET') {
  const fetched = [];
  return {
    fetched,
    context: {
      request: new Request('https://fwcoldpressed.in' + path, { method }),
      env: { ASSETS: { fetch: async request => {
        fetched.push(new URL(request.url).pathname);
        const pathname = new URL(request.url).pathname;
        if (pathname === '/admin.html') return new Response(html, { headers: { 'content-type': 'text/html' } });
        if (pathname === '/admin/sw.js') return new Response('self.addEventListener("install",()=>{});', { headers: { 'content-type': 'application/javascript' } });
        if (pathname === '/admin/manifest.webmanifest') return new Response('{"name":"FreshWay Owner"}', { headers: { 'content-type': 'application/json' } });
        return new Response('missing', { status: 404 });
      } } },
      next: async () => new Response('next')
    }
  };
}

{
  const { context, fetched } = makeContext('/admin/');
  const response = await onRequest(context);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(body, /href="\/admin\/manifest\.webmanifest"/);
  assert.match(body, /register\("\/admin\/sw\.js",\{scope:"\/admin\/",updateViaCache:"none"\}\)/);
  assert.match(body, /href="\/admin\.css\?v=1"/);
  assert.match(body, /src="\/admin\.js\?v=2"/);
  assert.match(body, /href="#overview"/);
  assert.deepEqual(fetched, ['/admin.html']);
}
{
  const { context } = makeContext('/admin/sw.js');
  const response = await onRequest(context);
  assert.equal(response.headers.get('service-worker-allowed'), '/admin/');
  assert.match(response.headers.get('content-type'), /javascript/i);
}
{
  const { context } = makeContext('/admin/manifest.webmanifest');
  const response = await onRequest(context);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/i);
}
{
  const { context } = makeContext('/admin/', 'HEAD');
  const response = await onRequest(context);
  assert.equal(await response.text(), '');
}
{
  const { context } = makeContext('/admin/unexpected');
  const response = await onRequest(context);
  assert.equal(response.status, 404);
}
console.log('Owner PWA route, manifest, worker scope, cache and noindex contracts OK');
