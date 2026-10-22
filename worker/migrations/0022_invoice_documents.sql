-- Invoice documents and tax snapshots. Additive only: existing orders and products are preserved.
ALTER TABLE products ADD COLUMN hsn_code TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0 AND gst_rate_bps <= 4000);
ALTER TABLE products ADD COLUMN gst_rate_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_confirmed IN (0,1));
ALTER TABLE order_items ADD COLUMN hsn_code TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0 AND gst_rate_bps <= 4000);
ALTER TABLE order_items ADD COLUMN gst_rate_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_confirmed IN (0,1));

CREATE TABLE IF NOT EXISTS invoice_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  document_type TEXT NOT NULL DEFAULT 'commercial_invoice' CHECK(document_type IN ('commercial_invoice','gst_tax_invoice','bill_of_supply')),
  legal_name TEXT NOT NULL DEFAULT '',
  business_address TEXT NOT NULL DEFAULT '',
  state_name TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  series_prefix TEXT NOT NULL DEFAULT 'FW',
  footer TEXT NOT NULL DEFAULT '',
  prices_include_tax INTEGER NOT NULL DEFAULT 1 CHECK(prices_include_tax IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO invoice_settings (id,enabled,document_type,series_prefix,prices_include_tax)
VALUES (1,0,'commercial_invoice','FW',1);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  financial_year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  document_type TEXT NOT NULL CHECK(document_type IN ('commercial_invoice','gst_tax_invoice','bill_of_supply')),
  financial_year TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  seller_snapshot TEXT NOT NULL,
  buyer_snapshot TEXT NOT NULL,
  totals_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0),
  gross_paise INTEGER NOT NULL CHECK(gross_paise >= 0),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(gst_rate_bps >= 0 AND gst_rate_bps <= 4000),
  taxable_paise INTEGER NOT NULL CHECK(taxable_paise >= 0),
  cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(cgst_paise >= 0),
  sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(sgst_paise >= 0),
  igst_paise INTEGER NOT NULL DEFAULT 0 CHECK(igst_paise >= 0),
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_issued ON invoices(customer_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id,id);
