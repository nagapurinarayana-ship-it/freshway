# FreshWay Owner free shop map picker

FreshWay uses OpenStreetMap with Leaflet for the Owner shop-location picker. This option does not require a paid maps API, Google API key, or billing account.

## How to set the exact shop pin

1. Open the Owner app and go to Settings.
2. Keep the human-readable business address unchanged.
3. Search for the shop address, locality, landmark or PIN code.
4. Select a search result only to move the map; search results are approximate and are not saved automatically.
5. Zoom in to the building, tap the actual shop entrance, verify the marker and save.
6. Reopen Settings and test the customer directions link on an Android phone.

The shop latitude and longitude are stored separately from the business address. Customer directions use the saved coordinates when present and fall back to the address if no pin has been saved. No order, checkout, pricing, notification or customer-address workflows depend on this picker.

## Free-service limits

- Leaflet is open-source map software; OpenStreetMap supplies the map data.
- The public OpenStreetMap tile service is community-funded and has a usage policy. It is not an unlimited commercial tile CDN; use normal caching and avoid bulk downloads or prefetching.
- Search is provided by the configured public geocoding/search endpoint and is also subject to its usage policy and rate limits. Search should be used interactively, not as a bulk geocoding service.
- If FreshWay traffic grows, keep the same open-source map UI and switch to a compliant free-tier or self-hosted tile/search service if needed. Do not add a paid API without explicit approval.
