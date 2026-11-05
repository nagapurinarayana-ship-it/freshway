import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workerRoot = fileURLToPath(new URL('..', import.meta.url));
function query(sql) {
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'freshway', '--remote',
    '--config', 'wrangler.jsonc', '--command', sql, '--json'
  ], { cwd: workerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const start = raw.indexOf('['), end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Wrangler did not return JSON for an invoice audit query.');
  return JSON.parse(raw.slice(start, end + 1)).flatMap(result =>
    Array.isArray(result?.results) ? result.results : []
  );
}

const settings = query('SELECT document_type,enabled FROM invoice_settings WHERE id=1')[0] || {};
const byType = query('SELECT document_type,COUNT(*) AS invoice_count FROM invoices GROUP BY document_type ORDER BY document_type');
const sql = `WITH invoice_lines AS (
  SELECT invoice_id,COUNT(*) AS line_count,SUM(gross_paise) AS gross_paise,
    SUM(COALESCE(cgst_paise,0)+COALESCE(sgst_paise,0)+COALESCE(igst_paise,0)) AS tax_paise
  FROM invoice_items GROUP BY invoice_id
), order_lines AS (
  SELECT order_id,COUNT(*) AS line_count,SUM(line_total) AS line_total
  FROM order_items GROUP BY order_id
)
SELECT COUNT(*) AS invoice_count,
  SUM(CASE WHEN COALESCE(l.line_count,0)=0 THEN 1 ELSE 0 END) AS invoices_without_items,
  SUM(CASE WHEN json_extract(i.totals_snapshot,'$.totalPaise') IS NULL
    OR CAST(json_extract(i.totals_snapshot,'$.totalPaise') AS INTEGER)<>ROUND(COALESCE(o.total,0)*100)
    THEN 1 ELSE 0 END) AS invoice_order_total_mismatches,
  SUM(CASE WHEN COALESCE(o.pricing_breakdown_known,0)=1
    AND COALESCE(l.gross_paise,0)<>ROUND(COALESCE(o.items_subtotal,0)*100)
    THEN 1 ELSE 0 END) AS known_invoice_line_subtotal_mismatches,
  SUM(CASE WHEN COALESCE(o.pricing_breakdown_known,0)<>1
    AND COALESCE(l.gross_paise,0)<>ROUND(COALESCE(o.items_subtotal,0)*100)
    THEN 1 ELSE 0 END) AS historical_line_subtotal_unverified,
  SUM(CASE WHEN COALESCE(l.gross_paise,0)<>ROUND(COALESCE(ol.line_total,0)*100)
    THEN 1 ELSE 0 END) AS invoice_order_item_line_mismatches,
  SUM(CASE WHEN COALESCE(l.line_count,0)<>COALESCE(ol.line_count,0)
    THEN 1 ELSE 0 END) AS invoice_order_item_count_mismatches,
  SUM(CASE WHEN COALESCE(o.pricing_breakdown_known,0)=1
    AND ROUND((COALESCE(o.items_subtotal,0)-COALESCE(o.coupon_discount,0)+COALESCE(o.delivery_fee,0))*100)
      <>ROUND(COALESCE(o.total,0)*100)
    THEN 1 ELSE 0 END) AS order_pricing_breakdown_mismatches,
  SUM(CASE WHEN i.document_type='commercial_invoice' AND COALESCE(l.tax_paise,0)<>0
    THEN 1 ELSE 0 END) AS commercial_records_with_tax,
  SUM(CASE WHEN COALESCE(l.tax_paise,0)<>0 THEN 1 ELSE 0 END) AS invoices_with_tax_amounts
FROM invoices i JOIN orders o ON o.id=i.order_id
LEFT JOIN invoice_lines l ON l.invoice_id=i.id
LEFT JOIN order_lines ol ON ol.order_id=o.id`;
const row = query(sql)[0] || {};
const keys = [
  'invoice_count','invoices_without_items','invoice_order_total_mismatches',
  'known_invoice_line_subtotal_mismatches','historical_line_subtotal_unverified',
  'invoice_order_item_line_mismatches','invoice_order_item_count_mismatches',
  'order_pricing_breakdown_mismatches','commercial_records_with_tax','invoices_with_tax_amounts'
];
const report = {
  readOnly: true,
  configuredDocumentType: settings.document_type || null,
  invoiceIssuanceEnabled: Number(settings.enabled || 0) === 1,
  issuedByDocumentType: byType.map(item => ({ documentType: item.document_type, count: Number(item.invoice_count || 0) })),
  ...Object.fromEntries(keys.map(key => [key, Number(row[key] || 0)]))
};
const problems = [
  'invoices_without_items','invoice_order_total_mismatches',
  'known_invoice_line_subtotal_mismatches','invoice_order_item_line_mismatches',
  'invoice_order_item_count_mismatches','order_pricing_breakdown_mismatches',
  'commercial_records_with_tax'
].filter(key => report[key] > 0).map(key => key + ': ' + report[key]);
console.log(JSON.stringify({ report, problems }, null, 2));
if (problems.length) process.exitCode = 1;
