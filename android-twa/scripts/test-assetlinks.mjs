import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('./generate-assetlinks.mjs', import.meta.url));
const cleanEnv = { ...process.env, FRESHWAY_ANDROID_SHA256_FINGERPRINTS: '' };

const missing = spawnSync(process.execPath, [generator], { encoding: 'utf8', env: cleanEnv });
assert.equal(missing.status, 1, 'Generator must reject a missing release fingerprint.');
assert.match(missing.stderr, /actual release signing SHA-256 fingerprint/i);

const malformed = spawnSync(process.execPath, [generator], {
  encoding: 'utf8',
  env: { ...process.env, FRESHWAY_ANDROID_SHA256_FINGERPRINTS: 'AA:BB:CC' }
});
assert.equal(malformed.status, 1, 'Generator must reject malformed fingerprints.');

const fingerprint = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':').toUpperCase();
const valid = spawnSync(process.execPath, [generator], {
  encoding: 'utf8',
  env: { ...process.env, FRESHWAY_ANDROID_SHA256_FINGERPRINTS: fingerprint }
});
assert.equal(valid.status, 0, 'Generator should accept a well-formed SHA-256 fingerprint.');
const statements = JSON.parse(valid.stdout);
assert.equal(statements.length, 1);
assert.deepEqual(statements[0].relation, ['delegate_permission/common.handle_all_urls']);
assert.equal(statements[0].target.namespace, 'android_app');
assert.equal(statements[0].target.package_name, 'in.fwcoldpressed.freshway');
assert.deepEqual(statements[0].target.sha256_cert_fingerprints, [fingerprint]);

console.log('Digital Asset Links generator tests passed (missing, malformed and valid fingerprint cases).');
