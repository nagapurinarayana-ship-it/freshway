import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../twa-manifest.json', import.meta.url), 'utf8'));
const expectedHost = 'fwcoldpressed.in';
const expectedPackageId = 'in.fwcoldpressed.freshway';

assert.equal(manifest.host, expectedHost, 'TWA host must remain the FreshWay production domain.');
assert.equal(manifest.packageId, expectedPackageId, 'Changing the package ID after first publication creates a different Play app.');
assert.match(manifest.packageId, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Android application ID must be a valid reverse-DNS identifier.');
assert.equal(manifest.name, 'FreshWay');
assert.equal(manifest.launcherName, 'FreshWay');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.startUrl, '/', 'TWA must launch the customer app, not the Owner dashboard.');
assert.equal(manifest.fallbackType, 'customtabs', 'Use a browser fallback rather than introducing a WebView-only wrapper.');
assert.equal(manifest.enableNotifications, true);
assert.equal(manifest.appVersion, '1.0.0');
assert.ok(Number.isInteger(manifest.appVersionCode) && manifest.appVersionCode > 0);
assert.ok(Number.isInteger(manifest.minSdkVersion) && manifest.minSdkVersion >= 23);
assert.equal(manifest.signingKey.path, './android.keystore');
assert.equal(manifest.signingKey.alias, 'android');

for (const [field, value] of Object.entries({
  iconUrl: manifest.iconUrl,
  maskableIconUrl: manifest.maskableIconUrl,
  webManifestUrl: manifest.webManifestUrl
})) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', field + ' must use HTTPS.');
  assert.equal(url.hostname, expectedHost, field + ' must use the canonical domain.');
  assert.equal(url.username, '', field + ' must not contain URL credentials.');
  assert.equal(url.password, '', field + ' must not contain URL credentials.');
}

assert.ok(manifest.iconUrl.endsWith('/icons/icon-512.png'), 'Launcher icon must be the 512px PNG asset.');
assert.ok(manifest.maskableIconUrl.endsWith('/icons/icon-512.png'), 'Maskable launcher icon must use the dedicated maskable asset.');
assert.ok(manifest.themeColor && manifest.backgroundColor, 'Theme and splash colors must be explicit.');
assert.ok(!manifest.fingerprints || manifest.fingerprints.length === 0, 'Do not commit a signing fingerprint before the release signing certificate is known.');

console.log('FreshWay TWA configuration checks passed.');
console.log('Package ID: ' + manifest.packageId);
console.log('Origin: https://' + manifest.host);
