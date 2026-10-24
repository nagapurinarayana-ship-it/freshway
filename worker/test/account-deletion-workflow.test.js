import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminAuth = readFileSync(new URL('../src/admin-auth.js', import.meta.url), 'utf8');
const passcodeAuth = readFileSync(new URL('../src/passcode-auth.js', import.meta.url), 'utf8');
const ownerModule = readFileSync(new URL('../../frontend/admin/account-deletions.js', import.meta.url), 'utf8');
const ownerHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');

test('signed-in deletion requests require JSON and an allowed browser origin', () => {
  assert.ok(passcodeAuth.includes("contentType !== 'application/json' || !requestOrigin || !isAllowedOrigin(env, requestOrigin)"));
});

test('account deletion completion calls the fulfilment helper and exposes safe failure diagnostics', () => {
  assert.match(adminAuth, /fulfillAccountDeletion/);
  assert.match(adminAuth, /status==='completed'/);
  assert.match(adminAuth, /freshway_account_deletion_fulfilment_failed/);
  assert.match(adminAuth, /no account data was changed/i);
  assert.match(adminAuth, /foreignKeyConflict=\/foreign key constraint failed\/i.test\(message\)/);
  assert.match(adminAuth, /integrityConflict=\/not null constraint failed\|check constraint failed\|unique constraint failed\/i.test\(message\)/);
  assert.match(adminAuth, /Reference: '\+errorId/);
  assert.doesNotMatch(adminAuth, /cannot be marked complete yet/);
});

test('rejections require an explanatory note at the API boundary', () => {
  assert.ok(adminAuth.includes("status==='rejected'&&note.length<10"));
});

test('Owner queue exposes guarded completion after review', () => {
  assert.match(ownerHtml, /id="accountDeletionPanel"/);
  assert.match(ownerHtml, /frontend\/admin\/account-deletions\.js/);
  assert.match(ownerModule, /data-deletion-action="in_review"/);
  assert.match(ownerModule, /data-deletion-action="rejected"/);
  assert.match(ownerModule, /data-deletion-action="completed"/);
  assert.match(ownerModule, /phone_last4/);
  assert.match(ownerModule, /FreshWayOwnerStoreProfile\?\.hasUnsavedChanges/);
  assert.match(ownerModule, /FreshWayOwnerInvoiceSettings\?\.hasUnsavedChanges/);
  assert.match(ownerModule, /Account deletion does not save these settings/);
});
