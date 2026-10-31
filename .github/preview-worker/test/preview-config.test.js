import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildPreviewConfig } from '../build-preview-config.mjs';

const productionId = '4b645f26-12ad-4805-bf22-12186122ad3a';
const previewId = '00000000-0000-4000-8000-000000000001';
const production = {
  name: 'freshway-api',
  main: 'src/admin-auth.js',
  d1_databases: [{ binding: 'DB', database_name: 'freshway', database_id: productionId }],
  vars: {
    FRESHWAY_ENVIRONMENT: 'production',
    APP_ORIGIN: 'https://fwcoldpressed.in',
    APP_ORIGINS: 'https://fwcoldpressed.in,https://freshway-f32.pages.dev',
    PRODUCTION_ONLY_MARKER: 'must-not-leak'
  },
  triggers: { crons: ['17 * * * *'] },
  routes: [{ pattern: 'fwcoldpressed.in/*', zone_name: 'fwcoldpressed.in' }],
  kv_namespaces: [{ binding: 'PRODUCTION_CACHE', id: 'production-kv-id' }]
};
const valid = {
  databaseId: previewId,
  appOrigin: 'https://feat-order-cancel-delivery-s.freshway-f32.pages.dev',
  appOrigins: 'https://feat-order-cancel-delivery-s.freshway-f32.pages.dev'
};

test('preview config uses a dedicated Worker and an explicitly separate D1 database', () => {
  const config = buildPreviewConfig(production, valid);
  assert.equal(config.name, 'freshway-api-preview');
  assert.equal(config.d1_databases[0].database_name, 'freshway-preview');
  assert.equal(config.d1_databases[0].database_id, previewId);
  assert.notEqual(config.d1_databases[0].database_id, productionId);
  assert.equal(config.vars.FRESHWAY_ENVIRONMENT, 'development');
  assert.equal(config.vars.FRESHWAY_PREVIEW_TEST_MODE, '1', 'Owner test mode must exist only on the isolated Preview Worker config');
  assert.equal(config.vars.APP_ORIGIN, valid.appOrigin);
  assert.equal(config.vars.APP_ORIGINS, valid.appOrigins);
  assert.equal('PRODUCTION_ONLY_MARKER' in config.vars, false, 'production-only variables must not leak into preview');
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.secrets.required, ['ADMIN_TOKEN', 'CUSTOMER_SESSION_SECRET', 'ADMIN_SESSION_SECRET']);
  assert.equal('triggers' in config, false);
  assert.equal('routes' in config, false);
  assert.equal('kv_namespaces' in config, false, 'production resource bindings must not leak into preview');
  assert.equal(production.d1_databases[0].database_id, productionId, 'building a preview must not mutate production config');
});

test('preview config fails closed when the database ID is missing, invalid, or production', () => {
  assert.throws(() => buildPreviewConfig(production, { ...valid, databaseId: '' }), /valid Cloudflare D1 UUID/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, databaseId: 'not-a-uuid' }), /valid Cloudflare D1 UUID/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, databaseId: productionId }), /matches production/i);
});

test('preview config fails closed if production adds a second D1 binding', () => {
  const expanded = {
    ...production,
    d1_databases: [...production.d1_databases, { binding: 'ANALYTICS_DB', database_name: 'analytics', database_id: '00000000-0000-4000-8000-000000000002' }]
  };
  assert.throws(() => buildPreviewConfig(expanded, valid), /exactly one source D1 binding/i);
});

test('preview config accepts HTTPS origins only and requires the primary origin in the allowlist', () => {
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigin: 'http://preview.example.com' }), /HTTPS origin/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigin: 'https://preview.example.com/path' }), /HTTPS origin/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigins: 'https://other.example.com' }), /must include/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigins: 'https://ok.example.com,not-an-origin' }), /HTTPS origin/i);
});


test('isolated preview workflow applies the current offers migration and exercises the D1-backed APIs', () => {
  const workflow = readFileSync(new URL('../../workflows/preview-worker.yml', import.meta.url), 'utf8');
  assert.match(workflow, /migrations\/0043_delivery_offers_fixed_coupons\.sql/);
  for (const historicalMigration of [
    '0037_order_delivery_scheduling.sql',
    '0038_anonymize_delivery_requests.sql',
    '0039_customer_preferred_delivery_date.sql',
    '0040_order_delivered_at.sql'
  ]) {
    assert.doesNotMatch(workflow, new RegExp('migrations\\/' + historicalMigration),
      'preview must not replay historical migrations on the current main schema');
  }
  assert.match(workflow, /only partially present/);
  assert.match(workflow, /freshway_preview_metadata/);
  assert.match(workflow, /name != '_cf_KV'/,
    'fresh D1 initialization must ignore Cloudflare\'s reserved internal _cf_KV table');
  assert.match(workflow, /api\/delivery-offers/);
  assert.match(workflow, /api\/coupons\/available/);
  assert.match(workflow, /api\/checkout\/quote/);
});


test('isolated preview workflow Bash blocks are syntactically valid', () => {
  const workflow = readFileSync(new URL('../../workflows/preview-worker.yml', import.meta.url), 'utf8');
  const lines = workflow.split(/\r?\n/);
  assert.equal(lines.filter(line => line.endsWith('\\\\')).length, 0,
    'shell line continuations must contain exactly one trailing backslash');
  const stepNames = [
    'Initialize isolated preview D1 baseline and apply feature migration 0043',
    'Smoke-test authenticated Delivery & Offers APIs, checkout, redemption limits, and idempotency'
  ];

  for (const name of stepNames) {
    const step = lines.findIndex(line => line.trim() === '- name: ' + name);
    assert.notEqual(step, -1, 'workflow step should exist: ' + name);
    let run = -1;
    for (let i = step + 1; i < lines.length && !/^      - name: /.test(lines[i]); i++) {
      if (lines[i].trim() === 'run: |') { run = i; break; }
    }
    assert.notEqual(run, -1, 'workflow step should have a multiline run script: ' + name);

    const scriptLines = [];
    for (let i = run + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() && !line.startsWith('          ')) break;
      scriptLines.push(line.trim() ? line.slice(10) : '');
    }
    assert.ok(scriptLines.length > 0, 'run script should not be empty: ' + name);

    const parsed = spawnSync('bash', ['-n'], { input: scriptLines.join('\n'), encoding: 'utf8' });
    assert.equal(parsed.status, 0, 'invalid Bash syntax in "' + name + '": ' + (parsed.stderr || parsed.stdout || 'unknown parse error'));
  }
});
