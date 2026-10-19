import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workerRoot = fileURLToPath(new URL('..', import.meta.url));
const database = 'freshway';
const config = 'wrangler.jsonc';

function execute(sql) {
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', database, '--remote',
    '--config', config, '--command', sql, '--json'
  ], { cwd: workerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Wrangler did not return JSON for: ' + sql);
  return JSON.parse(raw.slice(start, end + 1));
}

function findRows(value, predicate) {
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === 'object') && value.some(predicate)) return value;
    for (const item of value) {
      const found = findRows(item, predicate);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findRows(item, predicate);
      if (found) return found;
    }
  }
  return null;
}

function rowsFor(sql, predicate) {
  const data = execute(sql);
  const rows = findRows(data, predicate);
  if (!rows) throw new Error('Could not find query rows for: ' + sql + '\n' + JSON.stringify(data));
  return rows;
}

const required = {
  customers: ['id', 'name', 'phone', 'passcode_salt', 'passcode_hash', 'whatsapp_opt_in'],
  addresses: ['id', 'customer_id', 'house', 'area', 'city', 'pincode', 'is_default', 'deleted_at', 'latitude', 'longitude'],
  products: ['id', 'name', 'unit', 'price', 'active', 'category_id', 'image_data', 'stock_managed', 'stock_quantity', 'low_stock_threshold'],
  categories: ['id', 'name', 'slug', 'active', 'display_order'],
  orders: ['id', 'customer_id', 'address_id', 'total', 'payment_status', 'delivery_status', 'delivery_plan', 'client_order_id', 'payment_collected_at', 'is_test_order'],
  order_items: ['id', 'order_id', 'product_id', 'name', 'unit', 'qty', 'price', 'line_total', 'stock_reserved_qty'],
  order_address_snapshots: ['order_id', 'customer_id', 'address_id', 'recipient_name', 'delivery_phone', 'house_flat', 'area', 'city', 'pincode', 'delivery_note', 'place_name', 'place_id', 'latitude', 'longitude', 'location_updated_at'],
  home_promotions: ['id', 'image_data', 'image_mime_type', 'alt_text', 'display_order', 'active'],
  store_profile: ['id', 'store_name', 'phone', 'whatsapp', 'share_title', 'share_description'],
  auth_rate_limits: ['key', 'window_start', 'count']
};

const report = {};
const problems = [];
for (const [table, expected] of Object.entries(required)) {
  const rows = rowsFor('PRAGMA table_info("' + table + '")', row => 'name' in row && 'cid' in row);
  const actual = rows.map(row => String(row.name));
  const missing = expected.filter(column => !actual.includes(column));
  report[table] = { columnCount: actual.length, missing };
  if (missing.length) problems.push(table + ' missing columns: ' + missing.join(', '));
}

const indexes = rowsFor("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'", row => 'name' in row);
const indexNames = indexes.map(row => String(row.name));
const expectedIndexes = [
  'idx_orders_test_created',
  'idx_order_address_snapshots_customer',
  'idx_order_items_order',
  'idx_products_category_active',
  'idx_customers_phone_unique'
];
report.requiredIndexes = Object.fromEntries(expectedIndexes.map(name => [name, indexNames.includes(name)]));
for (const name of expectedIndexes) if (!indexNames.includes(name)) problems.push('missing index: ' + name);

const migrationRows = rowsFor('SELECT id,name FROM d1_migrations ORDER BY id', row => 'name' in row && 'id' in row);
report.migrations = migrationRows.map(row => ({ id: row.id, name: row.name }));
report.migrationCount = migrationRows.length;

console.log(JSON.stringify({ database, readOnly: true, report, problems }, null, 2));
if (problems.length) process.exitCode = 1;
