export async function onRequest(context) {
  const api = context.env.FRESHWAY_API;
  if (!api) {
    return new Response('FreshWay API service binding is not configured.', { status: 503 });
  }

  // Rebuild the request explicitly so the Authorization header is preserved
  // when the Pages Function forwards the call through the service binding.
  const request = new Request(context.request);
  const authorization = context.request.headers.get('Authorization');
  if (authorization) {
    request.headers.set('Authorization', authorization);
  }

  return api.fetch(request);
}
