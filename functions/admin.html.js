export async function onRequest(context) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return context.next();

  // Pages header rules are not applied to Pages Function responses.
  // Fetch the static Owner shell through ASSETS, then enforce the no-store
  // policy required for a reliably fresh dashboard.
  const assetUrl = new URL('/admin.html', context.request.url);
  const assetResponse = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), {
    method: 'GET',
    headers: context.request.headers
  }));
  if (!assetResponse.ok) return assetResponse;

  const headers = new Headers(assetResponse.headers);
  headers.set('cache-control', 'no-store, max-age=0, must-revalidate');

  return new Response(context.request.method === 'HEAD' ? null : assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}
