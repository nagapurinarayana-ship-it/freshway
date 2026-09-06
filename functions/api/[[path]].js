export async function onRequest(context) {
  const api = context.env.FRESHWAY_API;
  if (!api) {
    return new Response('FreshWay API service binding is not configured.', { status: 503 });
  }

  // Rebuild the request explicitly so both supported admin auth headers
  // survive the Pages -> Worker service binding hop.
  const request = new Request(context.request);
  const authorization = context.request.headers.get('Authorization');
  const adminToken = context.request.headers.get('X-Freshway-Admin-Token');
  if (authorization) request.headers.set('Authorization', authorization);
  if (adminToken) request.headers.set('X-Freshway-Admin-Token', adminToken);

  return api.fetch(request);
}
