const json = (data, status, origin = '*', cacheControl = 'private, no-store') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'vary': 'Origin'
  }
});

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
    !(latitude === 0 && longitude === 0);
}

export async function handleReverseGeocode(request, options = {}) {
  const origin = options.origin || '*';
  const fetcher = options.fetcher || fetch;
  const cache = options.cache || null;
  const waitUntil = options.waitUntil || (() => {});
  const url = new URL(request.url);

  if (request.method !== 'GET') return json({ error: 'Reverse geocoding only supports GET.' }, 405, origin);
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lon'));
  if (url.searchParams.get('lat') == null || url.searchParams.get('lon') == null ||
      !validCoordinates(latitude, longitude)) {
    return json({ error: 'Enter a valid map location.' }, 400, origin);
  }

  // Cache at near-building precision. Keep each app host's response isolated,
  // and only cache successful provider results.
  const cacheUrl = new URL('/__freshway/geocode/reverse', url.origin);
  cacheUrl.searchParams.set('lat', latitude.toFixed(6));
  cacheUrl.searchParams.set('lon', longitude.toFixed(6));
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch (_) {}
  }

  const providerUrl = new URL('https://nominatim.openstreetmap.org/reverse');
  providerUrl.searchParams.set('format', 'jsonv2');
  providerUrl.searchParams.set('addressdetails', '1');
  providerUrl.searchParams.set('zoom', '18');
  providerUrl.searchParams.set('layer', 'address');
  providerUrl.searchParams.set('lat', String(latitude));
  providerUrl.searchParams.set('lon', String(longitude));

  let upstream;
  try {
    upstream = await fetcher(providerUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FreshWay Address Lookup (https://fwcoldpressed.in)'
      },
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
  } catch (_) {
    return json({ error: 'The address lookup service is temporarily unavailable.' }, 502, origin);
  }
  if (!upstream || !upstream.ok) {
    return json({ error: 'The address lookup service could not resolve this pin.' }, 502, origin);
  }

  let result;
  try { result = await upstream.json(); }
  catch (_) { return json({ error: 'The address lookup service returned invalid data.' }, 502, origin); }
  if (!result || !result.address || typeof result.address !== 'object' || Array.isArray(result.address)) {
    return json({ error: 'The address lookup service returned no address details.' }, 502, origin);
  }

  const response = json(result, 200, origin, 'public, max-age=3600, s-maxage=3600');
  if (cache) {
    try { waitUntil(Promise.resolve(cache.put(cacheKey, response.clone()))); }
    catch (_) {}
  }
  return response;
}
