import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequest as apiOnRequest } from './api/[[path]].js';

const productionPath = fileURLToPath(new URL('./api/[[path]].js', import.meta.url));
const production = readFileSync(productionPath, 'utf8');
const workerAuthPath = fileURLToPath(new URL('../worker/src/passcode-auth.js', import.meta.url));
const workerAuth = readFileSync(workerAuthPath, 'utf8');

assert.match(production, /const isAddressApi = \/\^\\\/api\\\/addresses/);
assert.match(production, /const addressBody = isAddressApi && needsBody/);
assert.match(production, /typeof body === 'string' \? new TextEncoder\(\)\.encode\(body\)\.buffer/);
assert.match(production, /const isJsonResponse = response =>/);
assert.match(production, /if \(!isAddressApi \|\| isJsonResponse\(primaryResponse\)\)/);
assert.match(production, /const isStoreProfileApi = targetPath === '\/api\/store-profile'/);
assert.match(production, /const fallbackResponse = await fetch\(buildRequest\(target\.toString\(\)\)\)/);
assert.match(production, /Address service returned an unexpected response\./);
assert.match(production, /Address service is temporarily unavailable/);

const browserFixPath = fileURLToPath(new URL('../address-fix.js', import.meta.url));
const browserFix = readFileSync(browserFixPath, 'utf8');
assert.match(browserFix, /const addressPath=\/\^\\\/api\\\/addresses/);
assert.match(browserFix, /contentType\.split\(';',1\)\[0\]\.trim\(\)\.endsWith\('\/json'\)/);

const addressUiPath = fileURLToPath(new URL('../address-system-final.js', import.meta.url));
const addressUi = readFileSync(addressUiPath, 'utf8');
assert.match(addressUi, /async function readJsonResponse\(response\)/);
assert.match(addressUi, /Address service returned invalid data/);
assert.equal((addressUi.match(/await readJsonResponse\(r\)/g) || []).length, 4);

console.log('address API JSON-boundary regression contract OK');

assert.match(production, /const productionHosts = new Set/);
assert.match(production, /environment !== 'development'/);
assert.match(production, /production fallback is disabled for this host/);

// Preview deployments must fail closed without ever choosing the production API fallback.
const previewRequest = new Request('https://feature-branch.freshway-f32.pages.dev/api/health');
const missingEnvironment = await apiOnRequest({
  request: previewRequest,
  env: {},
  next: async () => new Response('next')
});
assert.equal(missingEnvironment.status, 503);
assert.match((await missingEnvironment.json()).error, /not configured for development/i);

// Even after opting into development, a missing service binding is an error, not a production fallback.
const missingBinding = await apiOnRequest({
  request: previewRequest,
  env: { FRESHWAY_ENVIRONMENT: 'development' },
  next: async () => new Response('next')
});
assert.equal(missingBinding.status, 503);
assert.match((await missingBinding.json()).error, /development API service binding/i);

// A configured binding is the only upstream used by a preview.
const boundResponse = await apiOnRequest({
  request: previewRequest,
  env: {
    FRESHWAY_ENVIRONMENT: 'development',
    FRESHWAY_API: {
      fetch: async request => {
        assert.equal(new URL(request.url).hostname, 'feature-branch.freshway-f32.pages.dev');
        assert.equal(request.headers.get('X-Freshway-Environment'), 'development');
        return Response.json({ ok: true, source: 'development-test-binding' });
      }
    }
  },
  next: async () => new Response('next')
});
assert.equal(boundResponse.status, 200);
assert.deepEqual(await boundResponse.json(), { ok: true, source: 'development-test-binding' });

// If the development binding returns a non-JSON address response, it still must not hit production.
const badBoundResponse = await apiOnRequest({
  request: new Request('https://feature-branch.freshway-f32.pages.dev/api/addresses', { method: 'GET' }),
  env: {
    FRESHWAY_ENVIRONMENT: 'development',
    FRESHWAY_API: { fetch: async () => new Response('<html>wrong upstream</html>', { headers: { 'content-type': 'text/html' } }) }
  },
  next: async () => new Response('next')
});
assert.equal(badBoundResponse.status, 503);

console.log('preview-to-production API isolation contract OK');


assert.match(workerAuth, /addressMatch/);
assert.match(production, /deleteAlias/);
assert.match(workerAuth, /Method not allowed/);
assert.match(workerAuth, /new Request\(new URL/);
assert.match(browserFix, /default\|delete/);
assert.match(addressUi, /dataset\.fwDelete\}\/delete/);
assert.match(addressUi, /method:'POST'/);


// Quick-commerce address regression guards: a new saved address has no item ID,
// search results require explicit customer choice, and order snapshots are immutable.
const addressApiPath = fileURLToPath(new URL('../worker/src/address-api.js', import.meta.url));
const addressApi = readFileSync(addressApiPath, 'utf8');
assert.match(addressApi, /const id = action === 'create' \? 0 : Number\(/);
assert.match(addressApi, /if \(action !== 'create' && \(!Number\.isInteger\(id\) \|\| id < 1\)\)/);
assert.doesNotMatch(addressApi, /UPDATE addresses SET label=\?,recipient_name=\?,delivery_phone=\?,building=\?,floor=\?,street=\?,locality=\?,district=\?,state=\?,latitude=\?,longitude=\?,accuracy_meters=\?,location_source=\?,place_id=\?,location_updated_at=\? WHERE id=\?/);
assert.match(addressApi, /Could not save the order delivery-address snapshot/);
assert.match(addressUi, /Choose the exact match\. Nothing is selected until you tap a result\./);
assert.match(addressUi, /data-fw-search-index/);
assert.match(addressUi, /const requestId=\+\+locationRequestId/);
console.log('quick-commerce address creation, explicit search choice, and immutable snapshot guards OK');
