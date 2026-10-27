const OWNER_CACHE_CONTROL = 'no-store, max-age=0, must-revalidate';
const OWNER_VERSIONED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const OWNER_MEDIA_CACHE_CONTROL = 'public, max-age=86400, must-revalidate';

// Only expose the existing, public Owner shell assets below /admin/. This lets
// the /admin/-scoped service worker control/cache the complete Owner UI without
// widening its scope to the customer application.
const OWNER_ASSETS = new Map([
  ['admin.css', '/admin.css'],
  ['admin.js', '/admin.js'],
  ['owner-pwa-install.js', '/owner-pwa-install.js'],
  ['owner-pwa-install.css', '/owner-pwa-install.css'],
  ['freshway-logo-master.webp', '/freshway-logo-master.webp'],
  ['freshway-logo-clean.svg', '/freshway-logo-clean.svg'],
  ['frontend/phone-display.js', '/frontend/phone-display.js'],
  ['frontend/admin/store-profile.js', '/frontend/admin/store-profile.js'],
  ['frontend/admin/delivery-management.js', '/frontend/admin/delivery-management.js'],
  ['frontend/admin/store-management.js', '/frontend/admin/store-management.js'],
  ['frontend/admin/customer-messages.js', '/frontend/admin/customer-messages.js'],
  ['frontend/admin/invoice-settings.js', '/frontend/admin/invoice-settings.js'],
  ['frontend/admin/account-deletions.js', '/frontend/admin/account-deletions.js'],
  ['frontend/catalogue-media.js', '/frontend/catalogue-media.js'],
  ['frontend/admin/catalogue.js', '/frontend/admin/catalogue.js'],
  ['frontend/admin/owner-lifecycle-autosave.js', '/frontend/admin/owner-lifecycle-autosave.js'],
  ['frontend/admin/push.js', '/frontend/admin/push.js'],
  ['frontend/admin/order-alerts.js', '/frontend/admin/order-alerts.js'],
  ['owner-lifecycle.js', '/owner-lifecycle.js'],
  ['owner-address-final.js', '/owner-address-final.js'],
  ['frontend/media/catalogue/groundnut-oil.svg', '/frontend/media/catalogue/groundnut-oil.svg'],
  ['frontend/media/catalogue/sunflower-oil.svg', '/frontend/media/catalogue/sunflower-oil.svg'],
  ['frontend/media/catalogue/hmt-rice.svg', '/frontend/media/catalogue/hmt-rice.svg'],
  ['frontend/media/catalogue/sona-masuri.svg', '/frontend/media/catalogue/sona-masuri.svg'],
  ['icons/icon-192-brand-v2.png', '/icons/icon-192-brand-v2.png'],
  ['icons/icon-512-brand-v2.png', '/icons/icon-512-brand-v2.png'],
  ['icons/icon-512-maskable-v2.png', '/icons/icon-512-maskable-v2.png']
]);

function responseWithHeaders(response, { worker = false, manifest = false, cacheControl = OWNER_CACHE_CONTROL } = {}) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', cacheControl);
  headers.set('x-robots-tag', 'noindex, nofollow');
  if (worker) {
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('service-worker-allowed', '/admin/');
  }
  if (manifest) headers.set('content-type', 'application/manifest+json; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function ownerHtml(source) {
  // Keep Owner assets under /admin/ so only the Owner-scoped service worker
  // controls the dashboard. The install controls and manifest live in admin.html.
  const html = source.replace(
    /(\b(?:src|href)=['\"])(?![\/#]|[a-z][a-z0-9+.-]*:)([^'\"]+)(['\"])/gi,
    '$1/admin/$2$3'
  );
  return html.replace(/<\/head>/i, '<meta name="robots" content="noindex,nofollow"></head>');
}

async function fetchAsset(context, url, assetPath, method, options = {}) {
  const assetUrl = new URL(assetPath, url.origin);
  assetUrl.search = url.search;
  const asset = await context.env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
  const hasVersion = Boolean(String(url.searchParams.get('v') || '').trim());
  const codeAsset = /\.(?:js|css)$/i.test(assetPath);
  const mediaAsset = /\.(?:svg|webp|png|jpe?g|avif|ico|woff2?)$/i.test(assetPath);
  // The Owner HTML carries versioned public asset URLs. Cache those by version,
  // while keeping its HTML, service worker, manifest, and all non-static routes fresh.
  const cacheControl = !options.worker && !options.manifest && codeAsset && hasVersion
    ? OWNER_VERSIONED_ASSET_CACHE_CONTROL
    : !options.worker && !options.manifest && mediaAsset
      ? (hasVersion ? OWNER_VERSIONED_ASSET_CACHE_CONTROL : OWNER_MEDIA_CACHE_CONTROL)
      : OWNER_CACHE_CONTROL;
  const response = responseWithHeaders(new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers: asset.headers
  }), { ...options, cacheControl });
  return method === 'HEAD'
    ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
    : response;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') return context.next();

  if (url.pathname === '/admin') {
    return new Response(null, {
      status: 308,
      headers: { location: '/admin/' + url.search, 'cache-control': OWNER_CACHE_CONTROL, 'x-robots-tag': 'noindex, nofollow' }
    });
  }

  if (url.pathname === '/admin/manifest.webmanifest') {
    return fetchAsset(context, url, '/admin/manifest.webmanifest', method, { manifest: true });
  }

  if (url.pathname === '/admin/sw.js') {
    return fetchAsset(context, url, '/admin/sw.js', method, { worker: true });
  }

  if (url.pathname === '/admin/' || url.pathname === '/admin/index.html') {
    if (url.pathname === '/admin/index.html') {
      return new Response(null, {
        status: 308,
        headers: { location: '/admin/' + url.search, 'cache-control': OWNER_CACHE_CONTROL, 'x-robots-tag': 'noindex, nofollow' }
      });
    }

    const asset = await context.env.ASSETS.fetch(new Request(new URL('/admin.html', url.origin), { method: 'GET' }));
    const headers = new Headers(asset.headers);
    headers.set('cache-control', OWNER_CACHE_CONTROL);
    headers.set('x-robots-tag', 'noindex, nofollow');
    headers.set('content-type', 'text/html; charset=UTF-8');
    if (!asset.ok) {
      return new Response(method === 'HEAD' ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers });
    }
    const html = ownerHtml(await asset.text());
    return new Response(method === 'HEAD' ? null : html, { status: asset.status, statusText: asset.statusText, headers });
  }

  if (url.pathname.startsWith('/admin/')) {
    const relativePath = url.pathname.slice('/admin/'.length);
    const assetPath = OWNER_ASSETS.get(relativePath);
    if (assetPath) return fetchAsset(context, url, assetPath, method);
  }

  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': OWNER_CACHE_CONTROL, 'x-robots-tag': 'noindex, nofollow' }
  });
}
