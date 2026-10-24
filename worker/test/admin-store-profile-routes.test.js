import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/admin-auth.js', import.meta.url), 'utf8');

test('Owner Store Profile read and save routes are protected by the admin session gate', () => {
  const gate = "if(url.pathname.startsWith('/api/admin/')||url.pathname==='/api/notifications/broadcast'){if(!(await validSession(request,env)))";
  const gateIndex = source.indexOf(gate);
  const getIndex = source.indexOf("url.pathname==='/api/admin/store-profile'&&request.method==='GET'");
  const patchIndex = source.indexOf("url.pathname==='/api/admin/store-profile'&&request.method==='PATCH'");
  assert.notEqual(gateIndex, -1, 'admin session gate must exist');
  assert.ok(getIndex > gateIndex, 'GET Store Profile route must follow the admin session gate');
  assert.ok(patchIndex > gateIndex, 'PATCH Store Profile route must follow the admin session gate');
  assert.match(source, /getStoreProfile\(env\)/, 'GET route must return persisted profile data');
  assert.match(source, /updateStoreProfile\(env,payload\)/, 'PATCH route must persist the supplied fields');
  assert.match(source, /Send valid Store Profile JSON\./, 'invalid JSON must return a useful client error');
});
