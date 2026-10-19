const OWNER_CACHE_CONTROL = 'no-store, max-age=0, must-revalidate';

// Only expose the existing, public Owner shell assets below /admin/. This lets
// the /admin/-scoped service worker control/cache the complete Owner UI without
// widening its scope to the customer application.
const OWNER_ASSETS = new Map([
  ['admin.css', '/admin.css'],
  ['admin.js', '/admin.js'],
  ['freshway-logo-master.webp', '/freshway-logo-master.webp'],
  ['freshway-logo-clean.svg', '/freshway-logo-clean.svg'],
  ['frontend/phone-display.js', '/frontend/phone-display.js'],
  ['frontend/admin/store-profile.js', '/frontend/admin/store-profile.js'],
  ['frontend/catalogue-media.js', '/frontend/catalogue-media.js'],
  ['frontend/admin/catalogue.js', '/frontend/admin/catalogue.js'],
  ['frontend/admin/owner-lifecycle-autosave.js', '/frontend/admin/owner-lifecycle-autosave.js'],
  ['frontend/admin/push.js', '/frontend/admin/push.js'],
  ['owner-lifecycle.js', '/owner-lifecycle.js'],
  ['owner-address-final.js', '/owner-address-final.js'],
  ['frontend/media/catalogue/groundnut-oil.svg', '/frontend/media/catalogue/groundnut-oil.svg'],
  ['frontend/media/catalogue/sunflower-oil.svg', '/frontend/media/catalogue/sunflower-oil.svg'],
  ['frontend/media/catalogue/hmt-rice.svg', '/frontend/media/catalogue/hmt-rice.svg'],
  ['frontend/media/catalogue/sona-masuri.svg', '/frontend/media/catalogue/sona-masuri.svg'],
  ['icons/icon-192.png', '/icons/icon-192.png'],
  ['icons/icon-512.png', '/icons/icon-512.png'],
  ['icons/icon-192-maskable.png', '/icons/icon-192-maskable.png'],
  ['icons/icon-512-maskable.png', '/icons/icon-512-maskable.png']
]);

function responseWithHeaders(response, { worker = false, manifest = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', OWNER_CACHE_CONTROL);
  headers.set('x-robots-tag', 'noindex, nofollow');
  if (worker) {
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('service-worker-allowed', '/admin/');
  }
  if (manifest) headers.set('content-type', 'application/manifest+json; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function ownerHtml(source) {
  // Keep every Owner asset inside /admin/ so its scoped service worker can
  // control those requests. Relative navigation fragments and "/" links stay
  // unchanged; relative asset paths become /admin/<asset-path>.
  const html = source.replace(
    /(\b(?:src|href)=["'])(?![\/#]|[a-z][a-z0-9+.-]*:)([^"']+)(["'])/gi,
    '$1/admin/$2$3'
  );
  const withInstallButton = html.replace(
    '<div class="top-actions">',
    '<div class="top-actions"><button id="ownerInstallBtn" class="ghost" type="button" aria-label="Install FreshWay Owner">Install app</button>'
  );
  return withInstallButton.replace(
    /<\/head>/i,
    '<link rel="manifest" href="/admin/manifest.webmanifest"><meta name="robots" content="noindex,nofollow"><script>(function(){let deferredPrompt=null;function installButton(){return document.getElementById("ownerInstallBtn")}window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();deferredPrompt=event;const button=installButton();if(button){button.hidden=false;button.textContent="Install app"}});window.addEventListener("appinstalled",function(){deferredPrompt=null;const button=installButton();if(button){button.hidden=true}});document.addEventListener("DOMContentLoaded",function(){const button=installButton();if(button){button.addEventListener("click",async function(){if(!deferredPrompt){alert("To install FreshWay Owner, open Chrome menu ⋮ and choose Install app. If that option is missing, keep the page online and refresh it, then try again.");return}deferredPrompt.prompt();const choice=await deferredPrompt.userChoice;deferredPrompt=null;if(choice&&choice.outcome==="accepted")button.hidden=true})}});if("serviceWorker" in navigator){navigator.serviceWorker.register("/admin/sw.js",{scope:"/admin/",updateViaCache:"none"}).then(function(registration){return registration.update().catch(function(error){console.warn("Owner service worker update check failed",error)})}).catch(function(error){console.error("Owner service worker registration failed",error)})}})()</script></head>'
  );
}

async function fetchAsset(context, url, assetPath, method, options = {}) {
  const assetUrl = new URL(assetPath, url.origin);
  assetUrl.search = url.search;
  const asset = await context.env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
  const response = responseWithHeaders(new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers: asset.headers
  }), options);
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
