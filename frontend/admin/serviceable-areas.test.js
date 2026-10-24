import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script=readFileSync(new URL('./serviceable-areas.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../admin.html',import.meta.url),'utf8');
const controller=readFileSync(new URL('../../admin.js',import.meta.url),'utf8');
const workerRoutes=readFileSync(new URL('../../worker/src/admin-data.js',import.meta.url),'utf8');

test('Owner has a dedicated serviceable-areas screen and feature module',()=>{
 assert.ok(html.includes('data-screen="serviceable-areas"'));
 assert.ok(html.includes('id="serviceable-areas"'));
 assert.ok(html.includes('serviceable-areas.js'));
 assert.ok(controller.includes("'serviceable-areas'"));
});
test('Owner module uses authenticated admin APIs and does not access the database directly',()=>{
 assert.ok(script.includes("api('/admin/serviceability')"));
 assert.ok(script.includes("api('/admin/serviceability/zones"));
 assert.ok(workerRoutes.includes('/api/admin/serviceability'));
 assert.doesNotMatch(script,/fetch\(['"]https?:|ADMIN_TOKEN|localStorage\.getItem\(['"]freshway-admin-session/);
});
test('zone editor exposes PIN, polygon, hybrid, priority and lifecycle configuration',()=>{
 for(const term of ['serviceabilityCoverageMode','serviceabilityPincodes','serviceabilityPolygonJson','serviceabilityAllowPinFallback','serviceabilityZoneStatus','serviceabilityPriority'])assert.ok(html.includes(term),term+' field missing');
 assert.ok(script.includes('coverageMode'));
 assert.ok(script.includes('allowPinFallback'));
 assert.ok(script.includes('data-zone-status="archived"'));
});
test('boundary drawing persists GeoJSON, supports reset, and uses Leaflet after lazy loading',()=>{
 assert.ok(script.includes('loadLeaflet'));
 assert.ok(script.includes('coordinates:[ring]'));
 assert.ok(script.includes('completeDrawing'));
 assert.ok(script.includes('clearPolygon'));
 assert.ok(script.includes('tile.openstreetmap.org'));
});
test('test-address checks do not create orders or modify settings',()=>{
 assert.ok(script.includes("api('/admin/serviceability/test'"));
 assert.doesNotMatch(script,/api\('\/orders|api\('\/admin\/orders/);
});
