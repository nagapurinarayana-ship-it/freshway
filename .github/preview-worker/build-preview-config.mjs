import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..');
const productionConfigPath = path.join(repositoryRoot, 'worker', 'wrangler.jsonc');

function requireHttpsOrigin(value, label) {
  const raw = String(value || '').trim();
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error(label + ' must be a valid HTTPS origin.'); }
  if (parsed.protocol !== 'https:' || parsed.origin !== raw || parsed.username || parsed.password) {
    throw new Error(label + ' must be an HTTPS origin without a path, query, credentials, or trailing slash.');
  }
  return parsed.origin;
}

export function buildPreviewConfig(productionConfig, {
  databaseId,
  appOrigin,
  appOrigins
}) {
  if (!productionConfig || typeof productionConfig !== 'object') throw new Error('Production Wrangler config is required.');
  const productionDatabase = (productionConfig.d1_databases || []).find(binding => binding.binding === 'DB');
  if (!productionDatabase?.database_id) throw new Error('Production D1 binding DB is missing; refusing to guess a database ID.');

  const previewId = String(databaseId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewId)) {
    throw new Error('FRESHWAY_PREVIEW_D1_DATABASE_ID must be a valid Cloudflare D1 UUID.');
  }
  if (previewId.toLowerCase() === String(productionDatabase.database_id).toLowerCase()) {
    throw new Error('Preview D1 database ID matches production. Refusing to generate a deployable preview config.');
  }

  const primaryOrigin = requireHttpsOrigin(appOrigin, 'FRESHWAY_PREVIEW_APP_ORIGIN');
  const origins = [...new Set(String(appOrigins || '').split(',').map(value => value.trim()).filter(Boolean)
    .map((value, index) => requireHttpsOrigin(value, 'FRESHWAY_PREVIEW_APP_ORIGINS[' + index + ']')))];
  if (!origins.includes(primaryOrigin)) {
    throw new Error('FRESHWAY_PREVIEW_APP_ORIGINS must include FRESHWAY_PREVIEW_APP_ORIGIN.');
  }

  if ((productionConfig.d1_databases || []).length !== 1 || productionDatabase.binding !== 'DB') {
    throw new Error('Preview builder supports exactly one source D1 binding (DB); explicitly redesign it before production adds more database bindings.');
  }

  // Build from an allowlist rather than cloning the production config. New production
  // bindings, vars, routes and cron triggers must never leak into the preview implicitly.
  return {
    name: 'freshway-api-preview',
    main: productionConfig.main,
    compatibility_date: productionConfig.compatibility_date,
    compatibility_flags: Array.isArray(productionConfig.compatibility_flags)
      ? [...productionConfig.compatibility_flags]
      : [],
    d1_databases: [{
      binding: 'DB',
      database_name: 'freshway-preview',
      database_id: previewId
    }],
    vars: {
      FRESHWAY_ENVIRONMENT: 'development',
      FRESHWAY_PREVIEW_TEST_MODE: '1',
      APP_ORIGIN: primaryOrigin,
      APP_ORIGINS: origins.join(',')
    },
    secrets: {
      required: ['ADMIN_TOKEN', 'CUSTOMER_SESSION_SECRET', 'ADMIN_SESSION_SECRET']
    },
    workers_dev: true
  };
}

function main() {
  const databaseId = process.env.FRESHWAY_PREVIEW_D1_DATABASE_ID;
  const appOrigin = process.env.FRESHWAY_PREVIEW_APP_ORIGIN;
  const appOrigins = process.env.FRESHWAY_PREVIEW_APP_ORIGINS;
  const productionConfig = JSON.parse(fs.readFileSync(productionConfigPath, 'utf8'));
  const preview = buildPreviewConfig(productionConfig, { databaseId, appOrigin, appOrigins });
  process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error('Preview config refused:', error?.message || error);
    process.exitCode = 1;
  }
}
