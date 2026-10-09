const escapeAttribute = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

async function loadShareMetadata(context) {
  const binding = context.env.FRESHWAY_API;
  if (!binding || typeof binding.fetch !== 'function') return null;
  try {
    const target = new URL('/api/store-profile', context.request.url);
    const response = await binding.fetch(new Request(target.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }));
    if (!response.ok) return null;
    const data = await response.json();
    const profile = data?.storeProfile || {};
    const title = String(profile.shareTitle || '').trim();
    const description = String(profile.shareDescription || '').trim();
    return title && description ? { title, description } : null;
  } catch (_) {
    return null;
  }
}

function replaceMeta(html, property, content) {
  const escaped = escapeAttribute(content);
  const pattern = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["'][^"']*["']\\s*/?>`, 'i');
  return html.replace(pattern, '<meta property="' + property + '" content="' + escaped + '">');
}
function replaceNameMeta(html, name, content) {
  const escaped = escapeAttribute(content);
  const pattern = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["'][^"']*["']\\s*/?>`, 'i');
  return html.replace(pattern, '<meta name="' + name + '" content="' + escaped + '">');
}

export async function onRequest(context) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return context.next();
  const assetUrl = new URL('/index.html', context.request.url);
  const assetResponse = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
  if (!assetResponse.ok) return assetResponse;

  const contentType = String(assetResponse.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return assetResponse;

  const metadata = await loadShareMetadata(context);
  if (!metadata) return assetResponse;

  let html = await assetResponse.text();
  html = replaceMeta(html, 'og:title', metadata.title);
  html = replaceNameMeta(html, 'twitter:title', metadata.title);
  html = replaceMeta(html, 'og:description', metadata.description);
  html = replaceNameMeta(html, 'twitter:description', metadata.description);

  const headers = new Headers(assetResponse.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.set('cache-control', 'no-store, max-age=0, must-revalidate');
  return new Response(context.request.method === 'HEAD' ? null : html, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}
