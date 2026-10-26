import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewConfig } from '../scripts/build-preview-config.mjs';

const productionId = '4b645f26-12ad-4805-bf22-12186122ad3a';
const previewId = '00000000-0000-4000-8000-000000000001';
const production = {
  name: 'freshway-api',
  main: 'src/admin-auth.js',
  d1_databases: [{ binding: 'DB', database_name: 'freshway', database_id: productionId }],
  vars: {
    FRESHWAY_ENVIRONMENT: 'production',
    APP_ORIGIN: 'https://fwcoldpressed.in',
    APP_ORIGINS: 'https://fwcoldpressed.in,https://freshway-f32.pages.dev'
  },
  triggers: { crons: ['17 * * * *'] }
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
  assert.equal(config.vars.APP_ORIGIN, valid.appOrigin);
  assert.equal(config.vars.APP_ORIGINS, valid.appOrigins);
  assert.equal(config.workers_dev, true);
  assert.equal('triggers' in config, false);
  assert.equal('routes' in config, false);
  assert.equal(production.d1_databases[0].database_id, productionId, 'building a preview must not mutate production config');
});

test('preview config fails closed when the database ID is missing, invalid, or production', () => {
  assert.throws(() => buildPreviewConfig(production, { ...valid, databaseId: '' }), /valid Cloudflare D1 UUID/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, databaseId: 'not-a-uuid' }), /valid Cloudflare D1 UUID/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, databaseId: productionId }), /matches production/i);
});

test('preview config accepts HTTPS origins only and requires the primary origin in the allowlist', () => {
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigin: 'http://preview.example.com' }), /HTTPS origin/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigin: 'https://preview.example.com/path' }), /HTTPS origin/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigins: 'https://other.example.com' }), /must include/i);
  assert.throws(() => buildPreviewConfig(production, { ...valid, appOrigins: 'https://ok.example.com,not-an-origin' }), /HTTPS origin/i);
});
