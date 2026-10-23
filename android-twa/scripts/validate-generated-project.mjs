import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('../generated/', import.meta.url).pathname);
const gradlePath = resolve(root, 'app/build.gradle');
let gradle;
try {
  gradle = readFileSync(gradlePath, 'utf8');
} catch {
  console.error('Generated Android project not found. Run npm run init, copy twa-manifest.json into generated/, then run npm run update.');
  process.exit(1);
}

const expectedIdPattern = 'in\\.fwcoldpressed\\.freshway';
for (const field of ['namespace', 'applicationId']) {
  const pattern = new RegExp(field + '\\s*(?:=\\s*)?["\\']' + expectedIdPattern + '["\\']');
  assert.match(gradle, pattern, 'Generated Gradle configuration must retain ' + field + ' = in.fwcoldpressed.freshway');
}

const targetMatch = gradle.match(/targetSdkVersion\\s+(\\d+)/) || gradle.match(/targetSdk\\s*=\\s*(\\d+)/);
assert.ok(targetMatch, 'Could not identify target SDK in generated Gradle configuration.');
assert.ok(Number(targetMatch[1]) >= 36, 'Google Play submissions must target API level 36 or higher.');

const compileMatch = gradle.match(/compileSdkVersion\\s+(\\d+)/) || gradle.match(/compileSdk\\s*=\\s*(\\d+)/);
assert.ok(compileMatch, 'Could not identify compile SDK in generated Gradle configuration.');
assert.ok(Number(compileMatch[1]) >= 36, 'Generated project must compile against API level 36 or higher.');

assert.match(gradle, /versionCode\\s+(?:=\\s*)?1\\b/, 'Initial build must use version code 1.');
assert.match(gradle, /versionName\\s+(?:=\\s*)?["']1\\.0\\.0["']/, 'Initial build must use version name 1.0.0.');
console.log('Generated FreshWay Android Gradle project checks passed (API 36+ and permanent package ID).');
