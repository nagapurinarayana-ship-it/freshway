import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const productionPath = fileURLToPath(new URL('./api/[[path]].js', import.meta.url));
const production = readFileSync(productionPath, 'utf8');
const workerAuthPath = fileURLToPath(new URL('../worker/src/passcode-auth.js', import.meta.url));
const workerAuth = readFileSync(workerAuthPath, 'utf8');

assert.match(production, /const isAddressApi = \/\^\\\/api\\\/addresses/);
assert.match(production, /const addressBody = isAddressApi && needsBody/);
assert.match(production, /typeof body === 'string' \? new TextEncoder\(\)\.encode\(body\)\.buffer/);
assert.match(production, /const isJsonResponse = response =>/);
assert.match(production, /if \(!isAddressApi \|\| isJsonResponse\(primaryResponse\)\)/);
assert.match(production, /if \(isStoreProfileApi && isJsonResponse\(primaryResponse\)\)/);
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

assert.match(workerAuth, /addressMatch/);
assert.match(production, /deleteAlias/);
assert.match(workerAuth, /Method not allowed/);
assert.match(workerAuth, /new Request\(new URL/);
assert.match(browserFix, /default\|delete/);
assert.match(addressUi, /dataset\.fwDelete\}\/delete/);
assert.match(addressUi, /method:'POST'/);
