# FreshWay Owner Google Maps picker setup

The Owner settings page prefers Google Maps when the optional Worker environment binding `GOOGLE_MAPS_BROWSER_API_KEY` is configured. Until then, the current OpenStreetMap picker remains available. Customer directions continue using Google Maps URLs and saved shop coordinates; no API key is needed for those directions URLs.

## Google Cloud setup

1. In Google Cloud Console, select or create a billing-enabled project.
2. Enable **Maps JavaScript API** and **Places API**. The picker uses Google Places suggestions when available and Google Maps Geocoder as a compatibility fallback.
3. Create a browser API key and apply **HTTP referrer restrictions** for the actual FreshWay Owner/customer origins that should load maps. Start with the production domain and add only the specific preview domains you use.
4. Apply API restrictions for the Maps JavaScript API and Places API (and Geocoding API if you explicitly enable/use that service in your project). Configure sensible quotas and billing alerts.
5. In the Cloudflare dashboard, open the `freshway-api` Worker settings and add `GOOGLE_MAPS_BROWSER_API_KEY` as a Worker secret. Do not commit the key to GitHub. It is a browser key, so HTTP-referrer and API restrictions are essential even though the backend only returns it to an authenticated Owner session.
6. Deploy the Worker and Pages app, then sign into `/admin/` and open Settings. The status should indicate Google Maps is ready when the key is accepted.
7. Search for the actual shop, select a result only to navigate the map, zoom to building/entrance level, tap the exact entrance, verify the marker, save, reopen Settings and test the customer directions link on an Android phone.

## Safety and fallback

- A searched place result is an approximate reference only; it is not stored automatically.
- The human-readable business address and saved latitude/longitude remain separate.
- If the key is missing, the existing OpenStreetMap picker stays active.
- If Google Maps fails to load, the Owner picker attempts to use the backup map.
- The customer directions link continues to use saved coordinates when present and falls back to the address when no pin has been saved.
