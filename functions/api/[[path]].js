export async function onRequest(context) {
  const binding = context.env.FRESHWAY_API;
  const fallbackOrigin = 'https://freshway-api.all-in-one-all.workers.dev';

  // Keep the same request path while supporting both the configured Pages
  // service binding and the production Worker URL as a safe fallback.
  const request = new Request(context.request);
  for (const name of ['Authorization', 'X-Freshway-Admin-Token', 'X-Freshway-Admin-Session']) {
    const value = context.request.headers.get(name);
    if (value) request.headers.set(name, value);
  }

  if (binding && typeof binding.fetch === 'function') return binding.fetch(request);

  const target = new URL(request.url);
  target.protocol = 'https:';
  target.host = new URL(fallbackOrigin).host;
  return fetch(new Request(target.toString(), request));
}
