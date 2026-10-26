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

  const preview = structuredClone(productionConfig);
  preview.name = 'freshway-api-preview';
  preview.d1_databases = preview.d1_databases.map(binding => binding.binding === 'DB'
    ? { ...binding, database_name: 'freshway-preview', database_id: previewId }
    : binding);
  preview.vars = {
    ...(preview.vars || {}),
    FRESHWAY_ENVIRONMENT: 'development',
    APP_ORIGIN: primaryOrigin,
    APP_ORIGINS: origins.join(',')
  };
  // Cron cleanup is operationally unnecessary in a preview and is intentionally disabled.
  delete preview.triggers;
  // Keep deployment preview-only even if production config gains a custom route later.
  delete preview.routes;
  preview.secrets = {
    ...(preview.secrets || {}),
    required: ['ADMIN_TOKEN', 'CUSTOMER_SESSION_SECRET', 'ADMIN_SESSION_SECRET']
  };
  preview.workers_dev = true;
  return preview;
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
