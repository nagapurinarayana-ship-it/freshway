const OWNER_CACHE_CONTROL = 'no-store, max-age=0, must-revalidate';

function responseWithHeaders(response, { html = false, worker = false, manifest = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', OWNER_CACHE_CONTROL);
  headers.set('x-robots-tag', 'noindex, nofollow');
  if (html) headers.set('content-type', 'text/html; charset=UTF-8');
  if (worker) {
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('service-worker-allowed', '/admin/');
  }
  if (manifest) headers.set('content-type', 'application/manifest+json; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function ownerHtml(source) {
  let html = source;
  // The legacy Owner shell is served at /admin.html. Make its relative assets
  // root-relative before rendering it below /admin/ so paths remain correct.
  html = html.replace(/(\\b(?:src|href)=["'])(?![\\/#]|[a-z][a-z0-9+.-]*:)([^"']+)(["'])/gi, '$1/$2$3');
  html = html.replace('</head>', '<link rel="manifest" href="/admin/manifest.webmanifest"><meta name="robots" content="noindex,nofollow"><script>if("serviceWorker" in navigator){addEventListener("load",()=>navigator.serviceWorker.register("/admin/sw.js",{scope:"/admin/",updateViaCache:"none"}).catch(()=>{}),{once:true})}</script></head>');
  return html;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') return context.next();

  if (url.pathname === '/admin/manifest.webmanifest') {
    const asset = await context.env.ASSETS.fetch(new Request(new URL('/admin/manifest.webmanifest', url), { method: 'GET' }));
    return responseWithHeaders(new Response(method === 'HEAD' ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers: asset.headers }), { manifest: true });
  }

  if (url.pathname === '/admin/sw.js') {
    const asset = await context.env.ASSETS.fetch(new Request(new URL('/admin/sw.js', url), { method: 'GET' }));
    return responseWithHeaders(new Response(method === 'HEAD' ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers: asset.headers }), { worker: true });
  }

  if (url.pathname !== '/admin' && url.pathname !== '/admin/' && url.pathname !== '/admin/index.html') {
    return new Response('Not found', { status: 404, headers: { 'cache-control': OWNER_CACHE_CONTROL, 'x-robots-tag': 'noindex, nofollow' } });
  }

  const asset = await context.env.ASSETS.fetch(new Request(new URL('/admin.html', url), { method: 'GET' }));
  const headers = new Headers(asset.headers);
  headers.set('cache-control', OWNER_CACHE_CONTROL);
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('content-type', 'text/html; charset=UTF-8');
  if (!asset.ok) return new Response(method === 'HEAD' ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers });
  const html = ownerHtml(await asset.text());
  return new Response(method === 'HEAD' ? null : html, { status: asset.status, statusText: asset.statusText, headers });
}
