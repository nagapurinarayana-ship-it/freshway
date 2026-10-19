import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const addressFixSource = readFileSync(new URL('../../address-fix.js', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const ownerServiceWorkerSource = readFileSync(new URL('../../admin/sw.js', import.meta.url), 'utf8');
const ownerInstallSource = readFileSync(new URL('../../owner-pwa-install.js', import.meta.url), 'utf8');
const ownerManifest = JSON.parse(readFileSync(new URL('../../admin/manifest.webmanifest', import.meta.url), 'utf8'));
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');
const adminJsSource = readFileSync(new URL('../../admin.js', import.meta.url), 'utf8');
const adminDataSource = readFileSync(new URL('../src/admin-data.js', import.meta.url), 'utf8');
const ownerLifecycleSource = readFileSync(new URL('../../owner-lifecycle.js', import.meta.url), 'utf8');
const workerIndexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const adminOrdersSource = readFileSync(new URL('../src/admin-orders.js', import.meta.url), 'utf8');

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

function installAddressFix(responder) {
  const calls = [];
  const window = {
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      return responder({ input: String(input), init, calls });
    }
  };

  vm.runInNewContext(addressFixSource, {
    window,
    location: { origin: 'https://freshway.test' },
    URL,
    Response,
    JSON,
    String,
    Number
  }, { filename: 'address-fix.js' });

  return { fetch: window.fetch, calls };
}

test('address DELETE fallback reports success only after confirming the address is absent', async () => {
  const harness = installAddressFix(({ input, calls }) => {
    if (calls.length === 1) return json({ error: 'Address not found.' }, 404);
    assert.equal(input, '/api/addresses');
    return json({ addresses: [{ id: 456 }] });
  });

  const response = await harness.fetch('/api/addresses/123', { method: 'DELETE' });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.alreadyDeleted, true);
  assert.equal(harness.calls.length, 2);
});

test('address DELETE fallback preserves 404 when the requested address still exists', async () => {
  const harness = installAddressFix(({ calls }) => calls.length === 1
    ? json({ error: 'Address not found.' }, 404)
    : json({ addresses: [{ id: 123 }, { id: 456 }] }));

  const response = await harness.fetch('/api/addresses/123', { method: 'DELETE' });
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.error, 'Address not found.');
  assert.equal(data.alreadyDeleted, undefined);
});

test('address DELETE fallback preserves 404 when the follow-up list request fails', async () => {
  const harness = installAddressFix(({ calls }) => {
    if (calls.length === 1) return json({ error: 'Address not found.' }, 404);
    throw new Error('Temporary network failure');
  });

  const response = await harness.fetch('/api/addresses/123', { method: 'DELETE' });
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.error, 'Address not found.');
});

test('address collection DELETE is never incorrectly reported as an already-deleted item', async () => {
  const harness = installAddressFix(() => json({ error: 'Not found.' }, 404));
  const response = await harness.fetch('/api/addresses', { method: 'DELETE' });

  assert.equal(response.status, 404);
  assert.equal(harness.calls.length, 1);
});

test('address script cache-busting version matches the service-worker shell entry', () => {
  const htmlVersion = indexHtml.match(/src="address-fix\.js\?v=([^"]+)"/)?.[1];
  const shellVersion = serviceWorkerSource.match(/['"]\/address-fix\.js\?v=([^'"]+)['"]/)?.[1];

  assert.ok(htmlVersion, 'index.html should version address-fix.js');
  assert.ok(shellVersion, 'the service-worker shell should cache address-fix.js');
  assert.equal(htmlVersion, shellVersion);
});

test('owner lifecycle script cache-busting version matches the service-worker shell entry', () => {
  const htmlVersion = adminHtml.match(/src="owner-lifecycle\.js\?v=([^"]+)"/)?.[1];
  const shellVersion = ownerServiceWorkerSource.match(/['"]\/admin\/owner-lifecycle\.js\?v=([^'"]+)['"]/)?.[1];

  assert.ok(htmlVersion, 'admin.html should version owner-lifecycle.js');
  assert.ok(shellVersion, 'the service-worker shell should cache owner-lifecycle.js');
  assert.equal(htmlVersion, shellVersion);
  assert.doesNotMatch(ownerServiceWorkerSource, /20260909-refresh-v3/, 'no stale owner-lifecycle URL rewrite should remain');
});

test('service worker loads online documents and executable code from the network first, with cache fallback', () => {
  assert.match(serviceWorkerSource, /if \(isNavigation && \['\/', '\/index\.html'\]\.includes\(url\.pathname\)\)/);
  assert.match(serviceWorkerSource, /url\.pathname === '\/admin\.html' \|\| url\.pathname\.startsWith\('\/admin\/'\)/);
  assert.match(ownerServiceWorkerSource, /const CACHE = 'fw-owner-v[0-9]+'/);
  assert.match(serviceWorkerSource, /const freshCode = \['script','style'\]\.includes\(destination\)/);
  assert.match(serviceWorkerSource, /freshCode \? new Request\(event\.request, \{ cache: 'no-store' \}\)/);
  assert.match(serviceWorkerSource, /const cached = await cache\.match\(event\.request\)/);
  assert.match(serviceWorkerSource, /if \(cached && !freshCode\)/);
  assert.match(serviceWorkerSource, /return \(await cache\.match\(event\.request\)\) \|\| Response\.error\(\)/);
  assert.match(serviceWorkerSource, /const CACHE = 'freshway-v46'/);
});


test('owner order UI distinguishes failed writes from post-save refresh failures', () => {
  const queueStart = ownerLifecycleSource.indexOf('function queueSave(');
  const queueEnd = ownerLifecycleSource.indexOf('async function openLifecycle(', queueStart);
  assert.ok(queueStart >= 0 && queueEnd > queueStart, 'queueSave should be present');
  const queue = ownerLifecycleSource.slice(queueStart, queueEnd);
  assert.match(queue, /Could not save order '\+field\+':/);
  assert.match(queue, /Order change was saved, but some details or dashboard totals failed to refresh/);
  assert.doesNotMatch(queue, /control\.value=previous;setSaveState\('Save failed','error'\)\}toast\(e\.message\|\|'Update failed'\)/);

  assert.match(ownerLifecycleSource, /Could not save order classification:/);
  assert.match(ownerLifecycleSource, /The API accepted the change, but the order list did not confirm it/);
  assert.match(ownerLifecycleSource, /Read both classification partitions before reporting failure/);
  assert.match(ownerLifecycleSource, /The database confirms this order is in Test orders/);
});



test('Owner status/payment and classification saves share a queue', () => {
  assert.ok(ownerLifecycleSource.includes('state.queue=state.queue.then(task)'));
  assert.ok(ownerLifecycleSource.includes('Queue classification writes behind pending status/payment auto-saves'));
});

test('Owner Live/Test switching queues a fresh load and ignores stale responses', () => {
  assert.match(adminJsSource, /let orderLoadSequence=0,orderLoadPending=false/);
  assert.ok(adminJsSource.includes("if(!validateOrderFilters()){orders=[];$('#ordersMeta').textContent='Filters need attention'"));
  assert.ok(adminJsSource.includes('if(requestId!==orderLoadSequence||modeAtStart!==testOrderMode)return'));
  assert.ok(adminJsSource.includes('if(orderLoadPending||requestId!==orderLoadSequence){orderLoadPending=false;void loadOrders(true)}'));
});

test('legacy Owner API permits any supported status and payment selection', () => {
  assert.doesNotMatch(workerIndexSource, /ORDER_STATUS_TRANSITIONS/);
  assert.doesNotMatch(workerIndexSource, /Cash can be marked collected only after delivery/);
  assert.doesNotMatch(workerIndexSource, /Only collected payments can be refunded/);
  assert.doesNotMatch(workerIndexSource, /Payment can be cancelled only for a cancelled order/);
});

test('legacy API uses field-scoped order concurrency guards and returns HTTP 409 on conflicts', () => {
  assert.ok(workerIndexSource.includes("const guards=['id=?'],whereParams=[id]"));
  assert.ok(workerIndexSource.includes("guards.push('delivery_status IS ?')"));
  assert.ok(workerIndexSource.includes("guards.push('is_test_order IS ?')"));
  assert.ok(workerIndexSource.includes('ORDER_CONFLICT:'));
  assert.ok(workerIndexSource.includes('?409:'));
});

test('modular API does not compare untouched order fields during a write', () => {
  assert.ok(adminOrdersSource.includes("const sets=[],params=[],guards=['id=?'],guardParams=[id]"));
  assert.ok(adminOrdersSource.includes("guards.push('delivery_status IS ?')"));
  assert.ok(adminOrdersSource.includes("guards.push('is_test_order IS ?')"));
  assert.ok(!adminOrdersSource.includes('WHERE id=? AND delivery_status IS ? AND payment_status IS ? AND delivery_plan IS ? AND is_test_order IS ?'));
});

test('Owner failed status/payment saves reconcile from the database before reporting state', () => {
  assert.ok(ownerLifecycleSource.includes('let recovered=false,refreshed=false'));
  assert.ok(ownerLifecycleSource.includes('const fresh=await getOrder(id)'));
  assert.ok(ownerLifecycleSource.includes('The server confirms this change was saved'));
  assert.ok(ownerLifecycleSource.includes('The order was refreshed to its saved database value'));
  assert.ok(ownerLifecycleSource.includes('if(!refreshed&&state.id===id)control.value=previous'));
  assert.ok(adminJsSource.includes('d.errorId?'));
  assert.ok(adminJsSource.includes('Reference: ${d.errorId}'));
});

test('unexpected admin database errors are logged with a reference and returned as HTTP 500', () => {
  assert.ok(adminDataSource.includes("event:'freshway_admin_data_error'"));
  assert.ok(adminDataSource.includes("code:'INTERNAL_ERROR',errorId"));
  assert.ok(adminDataSource.includes('},500)'));
  assert.ok(adminDataSource.includes('},409)'));
});

test('Owner script URLs and service-worker shell cache versions match', () => {
  const htmlAdmin = adminHtml.match(/src="admin\.js\?v=([^"]+)"/)?.[1];
  const shellAdmin = ownerServiceWorkerSource.match(/admin\.js\?v=([^'"]+)/)?.[1];
  const htmlLife = adminHtml.match(/src="owner-lifecycle\.js\?v=([^"]+)"/)?.[1];
  const shellLife = ownerServiceWorkerSource.match(/owner-lifecycle\.js\?v=([^'"]+)/)?.[1];
  assert.ok(htmlAdmin);
  assert.ok(shellAdmin);
  assert.equal(htmlAdmin,shellAdmin);
  assert.ok(htmlLife);
  assert.ok(shellLife);
  assert.equal(htmlLife,shellLife);
  assert.match(ownerServiceWorkerSource,/const CACHE = 'fw-owner-v[0-9]+'/);
  assert.match(adminHtml, /rel="manifest" href="\/admin\/manifest\.webmanifest"/);
  assert.match(adminHtml, /owner-pwa-install\.js\?v=20261019-install-parity-v1/);
  assert.match(adminHtml, /owner-pwa-install\.css\?v=20261019-install-parity-v1/);
  assert.match(ownerServiceWorkerSource, /owner-pwa-install\.js\?v=20261019-install-parity-v1/);
  assert.match(ownerServiceWorkerSource, /owner-pwa-install\.css\?v=20261019-install-parity-v1/);
  assert.match(ownerServiceWorkerSource, /\/admin\/icons\/icon-192\.svg/);
  assert.match(ownerServiceWorkerSource, /\/admin\/icons\/icon-512\.svg/);
  assert.doesNotMatch(ownerServiceWorkerSource, /icon-192-maskable\.png|icon-512-maskable\.png/, 'Owner shell must not reference missing icon assets');
  assert.match(ownerServiceWorkerSource, /REQUIRED_SHELL = \[[\s\S]*owner-pwa-install\.js\?v=20261019-install-parity-v1/);
  assert.match(ownerInstallSource, /beforeinstallprompt/);
  assert.match(ownerInstallSource, /promptEvent\.prompt\(\)/);
  assert.match(ownerInstallSource, /register\('\/admin\/sw\.js', \{ scope: '\/admin\/'/);
  assert.equal(ownerManifest.scope, '/admin/');
  assert.equal(ownerManifest.start_url, '/admin/');
  assert.ok(ownerManifest.icons.some(icon => icon.src.startsWith('/admin/') && icon.sizes === '192x192' && icon.type === 'image/svg+xml'));
  assert.ok(ownerManifest.icons.some(icon => icon.src.startsWith('/admin/') && icon.sizes === '512x512' && icon.type === 'image/svg+xml'));
});
