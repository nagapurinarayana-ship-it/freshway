import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('./serviceability-experience.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

test('customer serviceability never edits or replaces the protected address helper', () => {
  assert.match(script, /FreshWayAddressSystem\?\.getSelectedAddress/);
  assert.match(script, /helper\.open\('home'\)/);
  assert.doesNotMatch(script, /FreshWayAddressSystem\s*=|address-system-final\.js/);
});

test('GPS is queried only when the browser reports permission already granted', () => {
  assert.match(script, /navigator\.permissions\.query\(\{ name: 'geolocation' \}\)/);
  assert.match(script, /permission\.state !== 'granted'/);
  assert.match(script, /getCurrentPosition/);
  assert.doesNotMatch(script, /watchPosition|requestPermission/);
  assert.match(script, /MAX_ACCEPTABLE_ACCURACY_METERS = 150/);
  assert.match(script, /MISMATCH_DISTANCE_METERS = 500/);
});

test('mismatch prompt is dismissible and changes location only by opening the existing helper', () => {
  assert.match(script, /data-fw-location-change/);
  assert.match(script, /data-fw-location-dismiss/);
  assert.match(script, /sessionStorage\.setItem/);
  assert.match(script, /hideMismatch\(\);\s*openExistingAddressHelper\(\)/);
});

test('only enforced unserviceability is displayed to customers', () => {
  assert.match(script, /result\.mode === 'enforced' && result\.orderAllowed === false/);
  assert.match(script, /API failure is non-blocking/);
  assert.match(script, /cache: 'no-store'/);
});

test('customer home uses the location experience without removing its current address helper entry point', () => {
  assert.match(html, /id="addressBtn"/);
  assert.match(html, /id="fwLocationMismatchPrompt"/);
  assert.match(html, /id="fwServiceabilityStatus"/);
  assert.match(html, /serviceability-experience\.js/);
  assert.match(html, /serviceability\.css/);
});

test('new customer assets are included in the current app-shell cache for first-install/offline consistency', () => {
  assert.match(sw, /serviceability-experience\.js/);
  assert.match(sw, /serviceability\.css/);
});

test('the Zepto-style home location selector stylesheet is versioned, cached and separate from checkout styles', () => {
  const css = readFileSync(new URL('./serviceability.css', import.meta.url), 'utf8');
  const asset = html.match(/href="(frontend\/customer\/serviceability\.css\?v=[^"]+)"/)?.[1];
  assert.ok(asset, 'customer home location CSS has a versioned URL');
  assert.ok(sw.includes('/' + asset), 'service worker caches the exact home location CSS URL');
  assert.match(css, /button\.location-card/);
  assert.match(css, /\.location-card #homeAddressMeta/);
});
