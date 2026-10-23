import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminAuth = readFileSync(new URL('../src/admin-auth.js', import.meta.url), 'utf8');
const ownerModule = readFileSync(new URL('../../frontend/admin/account-deletions.js', import.meta.url), 'utf8');
const ownerHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');

test('signed-in deletion requests require JSON and an allowed browser origin', () => {
  assert.ok(adminAuth.includes("contentType !== 'application/json' || !requestOrigin || !isAllowedOrigin(env, requestOrigin)"));
});

test('account deletion cannot be marked complete before fulfilment exists', () => {
  assert.match(adminAuth, /status==='completed'\?'Account deletion cannot be marked complete yet/);
  assert.match(adminAuth, /status==='completed'\?409:400/);
});

test('rejections require an explanatory note at the API boundary', () => {\n  assert.ok(adminAuth.includes("status==='rejected'&&note.length<10"));\n});\n\ntest('Owner queue exposes review and rejection only, not a false completion action', () => {
  assert.match(ownerHtml, /id="accountDeletionPanel"/);
  assert.match(ownerHtml, /frontend\/admin\/account-deletions\.js/);
  assert.match(ownerModule, /data-deletion-action="in_review"/);
  assert.match(ownerModule, /data-deletion-action="rejected"/);
  assert.doesNotMatch(ownerModule, /data-deletion-action="completed"/);
  assert.match(ownerModule, /phone_last4/);
});
