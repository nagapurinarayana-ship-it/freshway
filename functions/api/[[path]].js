export async function onRequest(context) {
  const api = context.env.FRESHWAY_API;
  if (!api) {
    return new Response('FreshWay API service binding is not configured.', { status: 503 });
  }

  // Rebuild the request explicitly so the owner session header survives the
  // Pages -> Worker service-binding hop. The session is intentionally kept in
  // sessionStorage by the dashboard to avoid relying on cross-site cookies.
  const request = new Request(context.request);
  for (const name of ['Authorization', 'X-Freshway-Admin-Token', 'X-Freshway-Admin-Session']) {
    const value = context.request.headers.get(name);
    if (value) request.headers.set(name, value);
  }

  return api.fetch(request);
}
