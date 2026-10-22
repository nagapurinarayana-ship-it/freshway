import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillMissingInvoices } from '../src/invoice-service.js';

function backfillEnv({ enabled = true, candidateOrders = [{ id: 'FW-HIST-1', delivery_status: 'Delivered' }] } = {}) {
  let issued = false;
  const settings = {
    enabled: enabled ? 1 : 0, document_type: 'commercial_invoice', legal_name: '',
    business_address: '', state_name: '', state_code: '', gstin: '',
    series_prefix: 'FW', footer: '', prices_include_tax: 0
  };
  const order = {
    id: 'FW-HIST-1', customer_id: 'customer-1', customer_name: 'Test Customer',
    customer_phone: '919000000000', total: 100, delivery_status: 'Delivered',
    is_test_order: 0, created_at: '2026-10-21T10:00:00Z',
    registered_name: 'Test Customer', registered_phone: '919000000000',
    recipient_name: 'Test Customer', delivery_phone: '919000000000',
    house: '1 Main Road', building: '', floor: '', street: 'Main Road',
    area: 'Boduppal', locality: '', city: 'Hyderabad', district: 'Medchal',
    state: 'Telangana', pincode: '500092', landmark: '', note: ''
  };
  const item = {
    product_id: 'oil-1', name: 'Groundnut Oil', unit: '1 litre', qty: 1,
    price: 100, line_total: 100, hsn_code: '', gst_rate_bps: 0, gst_rate_confirmed: 0
  };
  const db = {
    prepare(sql) {
      let params = [];
      return {
        sql,
        bind(...values) { params = values; this.params = values; return this; },
        async first() {
          if (sql.startsWith('SELECT enabled,document_type')) return settings;
          if (sql.startsWith('SELECT id,invoice_number,document_type FROM invoices')) return issued
            ? { id: 'inv-FW-HIST-1', invoice_number: 'FW/26-27/000001', document_type: 'commercial_invoice' }
            : null;
          if (sql.startsWith('SELECT o.id,o.customer_id')) return order;
          if (sql.startsWith('SELECT store_name,about,phone')) return {
            store_name: 'FreshWay', address: 'Shop 1, Main Road, Hyderabad',
            about: '', phone: '', whatsapp: '', email: '', shop_latitude: null,
            shop_longitude: null, business_hours: '', delivery_info: '',
            share_title: 'FreshWay', share_description: 'Fresh groceries'
          };
          if (sql.startsWith('SELECT invoice_number,document_type,issue_date')) return issued
            ? { invoice_number: 'FW/26-27/000001', document_type: 'commercial_invoice', issue_date: '2026-10-22T10:00:00.000Z' }
            : null;
          return null;
        },
        async all() {
          if (sql.startsWith('SELECT COUNT(*) AS count FROM orders') && sql.includes("payment_status='Refunded'")) return { results: [{ count: 1 }] };
          if (sql.startsWith('SELECT o.id,o.delivery_status FROM orders')) return { results: candidateOrders };
          if (sql.startsWith('SELECT product_id,name,unit,qty,price,line_total')) return { results: [item] };
          return { results: [] };
        }
      };
    },
    async batch(statements) { issued = true; return statements.map(() => ({ meta: { changes: 1 } })); }
  };
  return { DB: db };
}

test('backfills existing delivered orders and reports refunded orders for separate review', async () => {
  const report = await backfillMissingInvoices(backfillEnv());
  assert.equal(report.enabled, true);
  assert.equal(report.scanned, 1);
  assert.equal(report.issued, 1);
  assert.equal(report.skippedRefunded, 1);
  assert.deepEqual(report.failed, []);
});

test('does not backfill while invoice issuance is disabled', async () => {
  const report = await backfillMissingInvoices(backfillEnv({ enabled: false }));
  assert.equal(report.enabled, false);
  assert.equal(report.issued, 0);
});
