export async function onRequest(context) {
  const binding = context.env.FRESHWAY_API;
  const fallbackOrigin = 'https://freshway-api.all-in-one-all.workers.dev';

  // Keep the same request path while supporting both the configured Pages
  // service binding and the production Worker URL as a safe fallback.
  // Normalize the legacy /default mutation endpoint here as well as in the
  // browser so cached clients cannot receive the Pages HTML shell and then
  // fail with "Unexpected token '<'" while parsing the response as JSON.
  const incoming = new URL(context.request.url);
  let targetPath = incoming.pathname;
  let method = context.request.method;
  let body = context.request.body;
  const defaultMatch = targetPath.match(/^\/api\/addresses\/(\d+)\/default\/?$/);
  const deleteAlias = targetPath.match(/^\/api\/addresses\/(\d+)\/delete\/?$/);
  if (deleteAlias && method === 'POST') {
    targetPath = `/api/addresses/${deleteAlias[1]}/delete`;
    body = JSON.stringify({ id: Number(deleteAlias[1]) });
  }

  if (defaultMatch && (method === 'POST' || method === 'PATCH')) {
    targetPath = `/api/addresses/${defaultMatch[1]}`;
    method = 'PATCH';
    body = JSON.stringify({ id: Number(defaultMatch[1]), default: true, isDefault: true });
  }

  const targetUrl = new URL(context.request.url);
  targetUrl.pathname = targetPath;
  targetUrl.search = incoming.search;
  const isAddressApi = /^\/api\/addresses(?:\/|$)/.test(targetPath);
  const isStoreProfileApi = targetPath === '/api/store-profile' && method === 'GET';
  const needsBody = !['GET', 'HEAD', 'DELETE'].includes(method);
  const addressBody = isAddressApi && needsBody
    ? (typeof body === 'string' ? new TextEncoder().encode(body).buffer : await context.request.clone().arrayBuffer())
    : null;
  const headers = new Headers(context.request.headers);
  if (isAddressApi) headers.set('Accept', 'application/json');

  const buildRequest = target => new Request(target, {
    method,
    headers,
    body: needsBody ? (isAddressApi ? addressBody : body) : undefined
  });

  const isJsonResponse = response => {
    const type = String(response?.headers?.get('content-type') || '').toLowerCase();
    return type.split(';', 1)[0].trim() === 'application/json';
  };

  const jsonError = (message, status = 502) => new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'access-control-allow-origin': context.request.headers.get('Origin') || '*',
      'access-control-allow-credentials': 'true'
    }
  });

  if (binding && typeof binding.fetch === 'function') {
    try {
      const primaryResponse = await binding.fetch(buildRequest(targetUrl.toString()));
      if (!isAddressApi || isJsonResponse(primaryResponse)) {
        if (!isStoreProfileApi) return primaryResponse;
        const cloned = primaryResponse.clone();
        const data = await cloned.json().catch(() => null);
        const profile = data?.storeProfile;
        const hasProfileData = profile && [profile.storeName, profile.about, profile.phone, profile.whatsapp, profile.email, profile.address, profile.businessHours, profile.deliveryInfo].some(value => String(value || '').trim());
        if (hasProfileData) return primaryResponse;
        // A stale/empty service binding must not hide the current production Store Profile.
      }
    } catch (_) {
      if (!isAddressApi && !isStoreProfileApi) throw _;
    }
  }

  const target = new URL(targetUrl.toString());
  target.protocol = 'https:';
  target.host = new URL(fallbackOrigin).host;

  if (isAddressApi || isStoreProfileApi) {
    try {
      const fallbackResponse = await fetch(buildRequest(target.toString()));
      if (isJsonResponse(fallbackResponse)) return fallbackResponse;
      return jsonError(isStoreProfileApi ? 'Store profile service returned an unexpected response.' : 'Address service returned an unexpected response.');
    } catch (_) {
      return jsonError(isStoreProfileApi ? 'Store profile service is temporarily unavailable. Please refresh and try again.' : 'Address service is temporarily unavailable. Please refresh and try again.');
    }
  }

  return fetch(buildRequest(target.toString()));
}
