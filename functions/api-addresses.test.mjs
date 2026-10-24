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
assert.match(production, /const isStoreProfileApi = \(targetPath === '\/api\/store-profile' \|\| targetPath === '\/api\/admin\/store-profile'\) && \['GET', 'PATCH'\]\.includes\(method\)/);
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
assert.match(addressUi, /const requestId\s*=\s*\+\+locationRequestId/);
assert.match(addressUi, /locationLookupPending/);
assert.match(addressUi, /editorCoordinates = previousCoordinates/);
assert.doesNotMatch(addressUi, /const preserve = labelFields\.map/);
console.log('quick-commerce address creation, explicit search choice, and immutable snapshot guards OK');

// Owner Store Profile calls /api/admin/store-profile. If the Pages service binding is
// stale or serves an incomplete profile, the API boundary must retry the production
// Worker route rather than returning empty data to the form.
const originalFetch = globalThis.fetch;
const completeStoreProfile = {
  storeName: 'FreshWay',
  about: 'Cold-pressed oils and rice',
  phone: '9876543210',
  whatsapp: '9876543210',
  email: 'hello@example.test',
  address: '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208',
  businessHours: '9 AM–7 PM',
  deliveryInfo: 'Local delivery',
  shareTitle: 'FreshWay',
  shareDescription: 'Fresh essentials delivered locally',
  shopLatitude: null,
  shopLongitude: null
};
try {
  for (const staleResponse of [
    () => Response.json({ storeProfile: { ...completeStoreProfile, address: '' } }),
    () => Response.json({ error: 'Not found' }, { status: 404 })
  ]) {
    let fallbackCalls = 0;
    globalThis.fetch = async request => {
      fallbackCalls += 1;
      const url = new URL(request.url);
      assert.equal(url.hostname, 'freshway-api.all-in-one-all.workers.dev');
      assert.equal(url.pathname, '/api/admin/store-profile');
      assert.equal(request.headers.get('cookie'), '__Host-freshway-admin-session=test-cookie');
      return Response.json({ storeProfile: completeStoreProfile });
    };
    const response = await apiOnRequest({
      request: new Request('https://fwcoldpressed.in/api/admin/store-profile', {
        headers: { cookie: '__Host-freshway-admin-session=test-cookie' }
      }),
      env: {
        FRESHWAY_API: {
          fetch: async request => {
            assert.equal(new URL(request.url).pathname, '/api/admin/store-profile');
            return staleResponse();
          }
        }
      },
      next: async () => new Response('next')
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { storeProfile: completeStoreProfile });
    assert.equal(fallbackCalls, 1);
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Owner Store Profile stale-binding fallback regression OK');


// A stale Pages service binding can return a 404 for Owner Store Profile writes.
// The Pages API boundary must replay the same JSON body and authenticated cookie
// to the production Worker, but must not bypass genuine 4xx validation failures.
const fallbackProfile = {
  storeName: 'FreshWay',
  about: 'Cold-pressed oils and rice',
  phone: '9876543210',
  whatsapp: '9876543210',
  email: 'hello@example.test',
  address: '1-1-LA0022, Road No 2, Laxminagar, Mancherial 504208',
  businessHours: '9 AM–7 PM',
  deliveryInfo: 'Local delivery',
  shareTitle: 'FreshWay',
  shareDescription: 'Fresh essentials delivered locally',
  shopLatitude: null,
  shopLongitude: null
};
const profilePatch = { ...fallbackProfile, about: 'A refreshed business description' };
const savedProfileResponse = { ok: true, storeProfile: profilePatch };
const priorFetch = globalThis.fetch;
try {
  let fallbackCalls = 0;
  globalThis.fetch = async request => {
    fallbackCalls += 1;
    assert.equal(new URL(request.url).hostname, 'freshway-api.all-in-one-all.workers.dev');
    assert.equal(new URL(request.url).pathname, '/api/admin/store-profile');
    assert.equal(request.headers.get('cookie'), '__Host-freshway-admin-session=test-cookie');
    assert.deepEqual(await request.json(), profilePatch);
    return Response.json(savedProfileResponse);
  };
  const patchResponse = await apiOnRequest({
    request: new Request('https://fwcoldpressed.in/api/admin/store-profile', {
      method: 'PATCH',
      headers: {
        Origin: 'https://fwcoldpressed.in',
        Cookie: '__Host-freshway-admin-session=test-cookie',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(profilePatch)
    }),
    env: {
      APP_ORIGIN: 'https://fwcoldpressed.in',
      APP_ORIGINS: 'https://fwcoldpressed.in',
      FRESHWAY_API: {
        fetch: async request => {
          assert.equal(new URL(request.url).pathname, '/api/admin/store-profile');
          assert.deepEqual(await request.clone().json(), profilePatch);
          return Response.json({ error: 'Not found' }, { status: 404 });
        }
      }
    },
    next: async () => new Response('next')
  });
  assert.equal(patchResponse.status, 200);
  assert.deepEqual(await patchResponse.json(), savedProfileResponse);
  assert.equal(fallbackCalls, 1);

  fallbackCalls = 0;
  globalThis.fetch = async () => {
    fallbackCalls += 1;
    throw new Error('Fallback must not be attempted for client validation errors');
  };
  const validationResponse = await apiOnRequest({
    request: new Request('https://fwcoldpressed.in/api/admin/store-profile', {
      method: 'PATCH',
      headers: {
        Origin: 'https://fwcoldpressed.in',
        Cookie: '__Host-freshway-admin-session=test-cookie',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(profilePatch)
    }),
    env: {
      APP_ORIGIN: 'https://fwcoldpressed.in',
      APP_ORIGINS: 'https://fwcoldpressed.in',
      FRESHWAY_API: {
        fetch: async () => Response.json({ error: 'Enter a complete business address.' }, { status: 400 })
      }
    },
    next: async () => new Response('next')
  });
  assert.equal(validationResponse.status, 400);
  assert.match((await validationResponse.json()).error, /complete business address/i);
  assert.equal(fallbackCalls, 0);
} finally {
  globalThis.fetch = priorFetch;
}
console.log('Owner Store Profile write fallback and validation boundary regression OK');

// Error responses must not reflect arbitrary caller Origins with credentials.
const disallowedCorsError = await apiOnRequest({
  request: new Request('https://preview.freshway-f32.pages.dev/api/health', {
    headers: { Origin: 'https://attacker.example' }
  }),
  env: {},
  next: async () => new Response('next')
});
assert.equal(disallowedCorsError.status, 503);
assert.equal(disallowedCorsError.headers.get('access-control-allow-origin'), null);
assert.equal(disallowedCorsError.headers.get('access-control-allow-credentials'), null);

const allowedCorsError = await apiOnRequest({
  request: new Request('https://preview.freshway-f32.pages.dev/api/health', {
    headers: { Origin: 'https://branch.freshway-f32.pages.dev' }
  }),
  env: { APP_ORIGIN_SUFFIXES: '.freshway-f32.pages.dev' },
  next: async () => new Response('next')
});
assert.equal(allowedCorsError.status, 503);
assert.equal(allowedCorsError.headers.get('access-control-allow-origin'), 'https://branch.freshway-f32.pages.dev');
assert.equal(allowedCorsError.headers.get('access-control-allow-credentials'), 'true');
console.log('API error CORS origin boundary regression OK');
