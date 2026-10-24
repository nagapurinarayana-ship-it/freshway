export async function onRequest(context) {
  const binding = context.env.FRESHWAY_API;
  const fallbackOrigin = 'https://freshway-api.all-in-one-all.workers.dev';
  const productionHosts = new Set(['fwcoldpressed.in', 'www.fwcoldpressed.in', 'freshway-f32.pages.dev']);

  // Keep the same request path while supporting both the configured Pages
  // service binding and the production Worker URL as a safe fallback.
  // Normalize the legacy /default mutation endpoint here as well as in the
  // browser so cached clients cannot receive the Pages HTML shell and then
  // fail with "Unexpected token '<'" while parsing the response as JSON.
  const incoming = new URL(context.request.url);
  const isProductionHost = productionHosts.has(incoming.hostname.toLowerCase());
  const environment = String(context.env.FRESHWAY_ENVIRONMENT || '').trim().toLowerCase();
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
  const isStoreProfileApi = (targetPath === '/api/store-profile' || targetPath === '/api/admin/store-profile') && method === 'GET';
  const needsBody = !['GET', 'HEAD', 'DELETE'].includes(method);
  const addressBody = isAddressApi && needsBody
    ? (typeof body === 'string' ? new TextEncoder().encode(body).buffer : await context.request.clone().arrayBuffer())
    : null;
  const headers = new Headers(context.request.headers);
  if (environment) headers.set('X-Freshway-Environment', environment);
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

  // Preview and local deployments must explicitly opt into the development environment.
  // Never infer a production API target from a missing service binding.
  if (!isProductionHost && environment !== 'development') {
    return jsonError('This preview environment is not configured for development API access.', 503);
  }
  if (!isProductionHost && (!binding || typeof binding.fetch !== 'function')) {
    return jsonError('The development API service binding is not configured.', 503);
  }

  if (binding && typeof binding.fetch === 'function') {
    try {
      const primaryResponse = await binding.fetch(buildRequest(targetUrl.toString()));
      if (!isAddressApi || isJsonResponse(primaryResponse)) {
        if (!isStoreProfileApi) return primaryResponse;
        const cloned = primaryResponse.clone();
        const data = await cloned.json().catch(() => null);
        const profile = data?.storeProfile;
        const hasProfileData = profile && typeof profile.storeName === 'string' && Boolean(profile.storeName.trim()) && typeof profile.address === 'string' && Boolean(profile.address.trim());
        if (hasProfileData) return primaryResponse;
        // A stale/empty service binding must not hide the current production Store Profile.
      }
    } catch (_) {
      if (!isAddressApi && !isStoreProfileApi) throw _;
    }
  }

  // Fail closed on every non-production host, including when a development binding
  // fails or returns an unexpected response. Do not fall back to live customer data.
  if (!isProductionHost) {
    return jsonError('Development API unavailable; production fallback is disabled for this host.', 503);
  }

  const target = new URL(targetUrl.toString());
  target.protocol = 'https:';
  target.host = new URL(fallbackOrigin).host;

  if (isAddressApi || isStoreProfileApi) {
    try {
      const fallbackResponse = await fetch(buildRequest(target.toString()));
      if (isJsonResponse(fallbackResponse)) {
        if (!isStoreProfileApi || !fallbackResponse.ok) return fallbackResponse;
        const fallbackData = await fallbackResponse.clone().json().catch(() => null);
        const fallbackProfile = fallbackData?.storeProfile;
        if (fallbackProfile &&
            typeof fallbackProfile.storeName === 'string' && fallbackProfile.storeName.trim() &&
            typeof fallbackProfile.address === 'string' && fallbackProfile.address.trim()) {
          return fallbackResponse;
        }
        return jsonError('Store Profile service returned incomplete data. Saved business details were not changed.');
      }
      return jsonError(isStoreProfileApi ? 'Store profile service returned an unexpected response.' : 'Address service returned an unexpected response.');
    } catch (_) {
      return jsonError(isStoreProfileApi ? 'Store profile service is temporarily unavailable. Please refresh and try again.' : 'Address service is temporarily unavailable. Please refresh and try again.');
    }
  }

  return fetch(buildRequest(target.toString()));
}
