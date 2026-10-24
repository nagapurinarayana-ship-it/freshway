import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertValidPng } from '../../pwa-icons-integrity.mjs';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const readText = (path) => readFileSync(resolve(root, path), 'utf8');
const readJson = (path) => JSON.parse(readText(path));

const config = readJson('android-twa/twa-manifest.json');
const webManifest = readJson('manifest.webmanifest');
const index = readText('index.html');
const privacy = readText('privacy.html');
const deletion = readText('delete-account.html');
const headers = readText('_headers');

assert.equal(webManifest.name, 'FreshWay');
assert.equal(webManifest.short_name, 'FreshWay');
assert.equal(webManifest.start_url, '/', 'PWA must launch the customer storefront.');
assert.equal(webManifest.scope, '/', 'PWA scope must include the customer storefront.');
assert.equal(webManifest.display, 'standalone', 'PWA must declare standalone display mode.');
assert.equal(config.host, 'fwcoldpressed.in');
assert.equal(config.startUrl, '/');

for (const [path, size] of [['/icons/icon-192.svg','192x192'], ['/icons/icon-512.svg','512x512']]) {
  const icon = webManifest.icons.find((item) => new URL(item.src, 'https://fwcoldpressed.in').pathname === path);
  assert.ok(icon, path + ' must be declared in manifest.webmanifest.');
  assert.equal(icon.sizes, size, path + ' must declare its install size.');
  assert.equal(icon.type, 'image/svg+xml', path + ' must declare image/svg+xml.');
  assert.ok(String(icon.purpose || '').split(' ').includes('any'), path + ' must be a normal app icon.');
}
assert.equal(webManifest.icons.some((item) => item.type === 'image/png' && new URL(item.src, 'https://fwcoldpressed.in').pathname.endsWith('.png')), false, 'Customer install manifest must not offer legacy P icons.');

const pngAssets = [
  { path: 'icons/icon-192-brand-v2.png', width: 192, height: 192, purpose: 'any' },
  { path: 'icons/icon-512-brand-v2.png', width: 512, height: 512, purpose: 'any' },
  { path: 'icons/icon-512-maskable-v2.png', width: 512, height: 512, purpose: 'maskable' }
];

for (const asset of pngAssets) {
  const fullPath = resolve(root, asset.path);
  const stat = statSync(fullPath);
  assert.ok(stat.isFile() && stat.size > 64, asset.path + ' must exist and be a non-empty image.');
  const bytes = readFileSync(fullPath);
  assertValidPng(bytes, { width: asset.width, height: asset.height, label: asset.path });
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], asset.path + ' must be a PNG.');
  assert.equal(bytes.readUInt32BE(16), asset.width, asset.path + ' must be ' + asset.width + 'px wide.');
  assert.equal(bytes.readUInt32BE(20), asset.height, asset.path + ' must be ' + asset.height + 'px high.');

  // PNGs are verified here for Android packaging; the customer install manifest uses branded SVG icons.
}

for (const value of [config.iconUrl, config.maskableIconUrl, config.webManifestUrl]) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'fwcoldpressed.in');
}
assert.equal(new URL(config.iconUrl).pathname, '/icons/icon-512-brand-v2.png');
assert.equal(new URL(config.maskableIconUrl).pathname, '/icons/icon-512-maskable-v2.png');

assert.match(index, /<link rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(index, /id="privacyPolicyBtn"/, 'Customer app must expose the privacy policy.');
assert.match(index, /id="requestAccountDeletionBtn"/, 'Customer app must expose account deletion.');
assert.match(index, /frontend\/customer\/account-actions\.js/, 'Customer account actions must be loaded.');

assert.match(privacy, /<title>Privacy Policy \| FreshWay<\/title>/);
assert.match(privacy, /href="\/delete-account\.html"/, 'Privacy policy must link to external account deletion.');
assert.match(headers, /\/privacy\.html\n\s+Cache-Control: no-store, max-age=0, must-revalidate/, 'Privacy policy page must revalidate promptly.');
assert.match(headers, /\/delete-account\.html\n\s+Cache-Control: no-store, max-age=0, must-revalidate/, 'Account-deletion page must revalidate promptly.');
assert.match(privacy, /id="privacyContact"/, 'Privacy policy must expose the configured public contact section.');
assert.match(privacy, /fetch\('\/api\/store-profile'/, 'Privacy policy must read configured store details instead of hardcoding contact values.');
assert.match(deletion, /<title>Account deletion \| FreshWay<\/title>/);
assert.match(deletion, /id="startForm"/);
assert.match(deletion, /id="verifyForm"/);
assert.match(deletion, /\/api\/account-deletion\/start/);
assert.match(deletion, /\/api\/account-deletion\/verify/);

for (const [path, html] of [['privacy.html', privacy], ['delete-account.html', deletion]]) {
  const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inlineScripts.length > 0, path + ' must include its user-interaction script.');
  for (const [, source] of inlineScripts) {
    assert.doesNotThrow(() => new Script(source, { filename: path }), path + ' contains invalid inline JavaScript.');
  }
}

console.log('FreshWay repository preflight passed: PWA identity, PNG dimensions, maskable icon declarations, privacy and deletion entry points.');
console.log('Release gate reminder: this check is static; verify public deployment, business/legal contact, retention terms and account-deletion E2E before Play submission.');
