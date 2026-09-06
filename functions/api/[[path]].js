export async function onRequest(context) {
  const api = context.env.FRESHWAY_API;
  if (!api) {
    return new Response('FreshWay API service binding is not configured.', { status: 503 });
  }
  return api.fetch(context.request);
}
