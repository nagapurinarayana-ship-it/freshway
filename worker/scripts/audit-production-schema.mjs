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
  customers: ['id', 'name', 'phone', 'passcode_salt', 'passcode_hash', 'auth_version', 'deleted_at', 'whatsapp_opt_in', 'created_at', 'updated_at'],
  addresses: ['id', 'customer_id', 'house', 'area', 'city', 'pincode', 'landmark', 'note', 'label', 'recipient_name', 'delivery_phone', 'building', 'floor', 'street', 'locality', 'district', 'state', 'latitude', 'longitude', 'accuracy_meters', 'location_source', 'place_id', 'location_updated_at', 'is_default', 'deleted_at'],
  products: ['id', 'name', 'unit', 'price', 'active', 'category_id', 'image_data', 'stock_managed', 'stock_quantity', 'low_stock_threshold'],
  categories: ['id', 'name', 'slug', 'active', 'display_order'],
  orders: ['id', 'customer_id', 'address_id', 'customer_name', 'customer_phone', 'total', 'payment_status', 'delivery_status', 'delivery_plan', 'client_order_id', 'payment_collected_at', 'is_test_order', 'updated_at'],
  order_items: ['id', 'order_id', 'product_id', 'name', 'unit', 'qty', 'price', 'line_total', 'stock_reserved_qty'],
  order_address_snapshots: ['order_id', 'customer_id', 'address_id', 'recipient_name', 'delivery_phone', 'house_flat', 'building', 'floor', 'street', 'area', 'locality', 'city', 'district', 'state', 'pincode', 'landmark', 'delivery_note', 'latitude', 'longitude', 'accuracy_meters', 'location_source', 'location_updated_at', 'place_name', 'place_id'],
  home_promotions: ['id', 'image_data', 'image_mime_type', 'alt_text', 'display_order', 'active'],
  store_profile: ['id', 'store_name', 'about', 'phone', 'whatsapp', 'email', 'address', 'shop_latitude', 'shop_longitude', 'business_hours', 'delivery_info', 'share_title', 'share_description', 'created_at', 'updated_at'],
  push_subscriptions: ['customer_id'],
  notification_events: ['customer_id', 'order_id'],
  account_deletion_requests: ['id', 'customer_id', 'phone_snapshot', 'status', 'source', 'admin_note', 'updated_at', 'processed_at'],
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
  'idx_customers_phone_unique',
  'idx_customers_active_phone',
  'idx_account_deletion_requests_one_active',
  'idx_account_deletion_requests_status_created',
  'idx_account_deletion_requests_customer_created',
  'idx_addresses_customer_deleted'
];
report.requiredIndexes = Object.fromEntries(expectedIndexes.map(name => [name, indexNames.includes(name)]));
for (const name of expectedIndexes) if (!indexNames.includes(name)) problems.push('missing index: ' + name);

const migrationRows = rowsFor('SELECT id,name FROM d1_migrations ORDER BY id', row => 'name' in row && 'id' in row);
report.migrations = migrationRows.map(row => ({ id: row.id, name: row.name }));
report.migrationCount = migrationRows.length;

const snapshotRedactionMigration = '0035_nullable_snapshot_customer_id_for_erasure.sql';
const redactionMigrationApplied = migrationRows.some(row => String(row.name) === snapshotRedactionMigration);
const accountDeletionAnonymizationMigration = '0036_anonymize_completed_deletion_requests.sql';
const accountDeletionAnonymizationApplied = migrationRows.some(row => String(row.name) === accountDeletionAnonymizationMigration);
const snapshotColumns = rowsFor(
  'PRAGMA table_info("order_address_snapshots")',
  row => 'name' in row && 'notnull' in row
);
const snapshotCustomerId = snapshotColumns.find(row => String(row.name) === 'customer_id');
report.snapshotErasureCompatibility = {
  migrationApplied: redactionMigrationApplied,
  customerIdAllowsNull: snapshotCustomerId ? Number(snapshotCustomerId.notnull) === 0 : false
};
// The standalone audit may race the release workflow. Enforce this contract
// once the migration is recorded; the Worker release runs this audit after migrations.
if (redactionMigrationApplied && (!snapshotCustomerId || Number(snapshotCustomerId.notnull) !== 0)) {
  problems.push('order_address_snapshots.customer_id must allow NULL for account erasure');
}
const deletionSummaryColumns = rowsFor(
  'PRAGMA table_info("account_deletion_summary")',
  row => 'name' in row
).map(row => String(row.name));
report.accountDeletionAnonymizationCompatibility = {
  migrationApplied: accountDeletionAnonymizationApplied,
  summaryTableReady: ['id','completed_count','latest_completed_at'].every(column => deletionSummaryColumns.includes(column))
};
if (accountDeletionAnonymizationApplied && !report.accountDeletionAnonymizationCompatibility.summaryTableReady) {
  problems.push('account_deletion_summary is missing required aggregate columns');
}


// Read-only invoice configuration and integrity summary. Never print customer data or a full tax number.
const invoiceSettingsRows = rowsFor(
  'SELECT enabled,document_type,legal_name,business_address,state_name,state_code,gstin,series_prefix,footer,prices_include_tax,updated_at FROM invoice_settings WHERE id=1',
  row => 'enabled' in row && 'document_type' in row
);
const settings = invoiceSettingsRows[0];
report.invoiceSettings = {
  rowFound: Boolean(settings),
  enabled: Number(settings?.enabled || 0) === 1,
  documentType: String(settings?.document_type || ''),
  legalNamePresent: Boolean(String(settings?.legal_name || '').trim()),
  businessAddressPresent: Boolean(String(settings?.business_address || '').trim()),
  stateNamePresent: Boolean(String(settings?.state_name || '').trim()),
  stateCodePresent: Boolean(String(settings?.state_code || '').trim()),
  taxNumberPresent: Boolean(String(settings?.gstin || '').trim()),
  taxNumberLast4: String(settings?.gstin || '').trim().slice(-4),
  footerPresent: Boolean(String(settings?.footer || '').trim()),
  pricesIncludeTax: Number(settings?.prices_include_tax ?? 1) === 1,
  updatedAt: settings?.updated_at || null
};
if (!settings) problems.push('invoice_settings row id=1 is missing');

const storeRows = rowsFor(
  'SELECT store_name,address,phone FROM store_profile WHERE id=1',
  row => 'store_name' in row && 'address' in row
);
const store = storeRows[0];
report.storeProfile = {
  rowFound: Boolean(store),
  storeNamePresent: Boolean(String(store?.store_name || '').trim()),
  addressPresent: Boolean(String(store?.address || '').trim()),
  phonePresent: Boolean(String(store?.phone || '').trim())
};
if (!store) problems.push('store_profile row id=1 is missing');

const invoiceCounts = rowsFor(
  'SELECT document_type,COUNT(*) AS total FROM invoices GROUP BY document_type ORDER BY document_type',
  row => 'document_type' in row && 'total' in row
);
report.invoicesByDocumentType = Object.fromEntries(invoiceCounts.map(row => [String(row.document_type), Number(row.total || 0)]));
const invoiceTotalRows = rowsFor(
  'SELECT COUNT(*) AS total FROM invoices',
  row => 'total' in row
);
report.invoiceTotal = Number(invoiceTotalRows[0]?.total || 0);
const itemTaxRows = rowsFor(
  'SELECT COUNT(*) AS total FROM invoice_items WHERE COALESCE(cgst_paise,0)>0 OR COALESCE(sgst_paise,0)>0 OR COALESCE(igst_paise,0)>0',
  row => 'total' in row
);
report.invoiceItemsWithNonZeroTax = Number(itemTaxRows[0]?.total || 0);

// Commercial receipts need the public Store Profile identity and address; the tax number is
// optional display text. Do not infer GST registration from its presence or change any settings.
if (settings?.document_type === 'commercial_invoice' && !report.storeProfile.storeNamePresent) {
  problems.push('commercial receipt is configured but Store Profile name is blank');
}
if (settings?.document_type === 'commercial_invoice' && !report.storeProfile.addressPresent) {
  problems.push('commercial receipt is configured but Store Profile address is blank');
}

console.log(JSON.stringify({ database, readOnly: true, report, problems }, null, 2));
if (problems.length) process.exitCode = 1;
