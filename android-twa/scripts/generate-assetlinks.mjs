import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../twa-manifest.json', import.meta.url), 'utf8'));
const raw = String(process.env.FRESHWAY_ANDROID_SHA256_FINGERPRINTS || '').trim();

if (!raw) {
  console.error('Set FRESHWAY_ANDROID_SHA256_FINGERPRINTS to the actual release signing SHA-256 fingerprint(s) from Play Console before generating assetlinks.json.');
  process.exit(1);
}

const fingerprints = [...new Set(raw.split(/[\s,;]+/).filter(Boolean).map(value => value.toUpperCase()))];
const fingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
for (const fingerprint of fingerprints) {
  if (!fingerprintPattern.test(fingerprint)) {
    console.error('Invalid SHA-256 certificate fingerprint: ' + fingerprint);
    process.exit(1);
  }
}

const assetLinks = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: manifest.packageId,
    sha256_cert_fingerprints: fingerprints
  }
}];

process.stdout.write(JSON.stringify(assetLinks, null, 2) + '\n');
