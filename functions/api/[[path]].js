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
  if (defaultMatch && (method === 'POST' || method === 'PATCH')) {
    targetPath = `/api/addresses/${defaultMatch[1]}`;
    method = 'PATCH';
    body = JSON.stringify({ id: Number(defaultMatch[1]), default: true, isDefault: true });
  }

  const targetUrl = new URL(context.request.url);
  targetUrl.pathname = targetPath;
  targetUrl.search = incoming.search;
  const request = new Request(targetUrl.toString(), {
    method,
    headers: context.request.headers,
    body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : body
  });
  for (const name of ['Authorization', 'X-Freshway-Admin-Token', 'X-Freshway-Admin-Session', 'Cookie']) {
    const value = context.request.headers.get(name);
    if (value) request.headers.set(name, value);
  }

  if (binding && typeof binding.fetch === 'function') return binding.fetch(request);

  const target = new URL(request.url);
  target.protocol = 'https:';
  target.host = new URL(fallbackOrigin).host;
  return fetch(new Request(target.toString(), request));
}
