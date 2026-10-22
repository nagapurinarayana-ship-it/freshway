const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('admin.html', 'utf8');
const adminSource = fs.readFileSync('admin.js', 'utf8');
const source = fs.readFileSync('frontend/admin/invoice-settings.js', 'utf8');
assert.match(html, /admin\.js\?v=20261022-invoice-api-fallback-v2/);
assert.match(html, /frontend\/admin\/invoice-settings\.js\?v=20261022-invoice-backfill-v4/);
assert.match(adminSource, /FreshWayOwnerInvoiceSettings\)loads\.push\(window\.FreshWayOwnerInvoiceSettings\.load\(\{api\}\)\)/);
assert.match(adminSource, /await Promise\.all\(loads\)/);
assert.match(source, /window\.FreshWayOwnerInvoiceSettingsApi\|\|window\.api/, 'Save must fall back to the shared Owner API if the settings loader has not registered its API yet');
assert.ok(html.includes('id="invoiceBackfillBtn"'), 'Owner Settings must expose an explicit retry for missing invoices on existing dispatched orders');
assert.match(source, /\/admin\/invoices\/backfill/, 'backfill control must call the authenticated backfill endpoint');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const checked = id === 'invoicePricesIncludeTax';
    elements.set(id, {
      id, value: id === 'invoiceSeriesPrefix' ? 'FW' : (id === 'invoiceDocumentType' ? 'commercial_invoice' : ''),
      checked, disabled: false, dataset: {}, handlers: {},
      classList: { toggle() {} },
      addEventListener(name, callback) { this.handlers[name] = callback; },
      set textContent(value) { this._textContent = String(value); },
      get textContent() { return this._textContent || ''; }
    });
  }
  return elements.get(id);
}
const sandbox = {
  window: {},
  document: { querySelector(selector) { return element(String(selector).replace(/^#/, '')); } }
};
vm.runInNewContext(source, sandbox);
const button = element('invoiceSettingsSaveBtn');

// The button is wired synchronously when the script loads, not after GET finishes.
assert.equal(typeof button.handlers.click, 'function');

let resolveGet;
const patchCalls = [];
const api = (path, options = {}) => {
  if (!options.method) return new Promise(resolve => { resolveGet = resolve; });
  assert.equal(path, '/admin/invoice-settings');
  assert.equal(options.method, 'PATCH');
  patchCalls.push(JSON.parse(options.body));
  return Promise.resolve({ invoiceSettings: {
    enabled: true, documentType: 'commercial_invoice', legalName: '',
    businessAddress: '', stateName: '', stateCode: '',
    gstin: '', seriesPrefix: 'FW', footer: 'Keep this footer', pricesIncludeTax: false
  }});
};

const loading = sandbox.window.FreshWayOwnerInvoiceSettings.load({ api });
element('invoiceEnabled').checked = true;
element('invoiceEnabled').handlers.change();
element('invoiceDocumentType').value = 'gst_tax_invoice';
element('invoiceDocumentType').handlers.change();
// Keep optional seller overrides blank: non-GST records use the saved Store Profile.
element('invoiceFooter').value = 'Keep this footer';
element('invoiceFooter').handlers.input();

(async () => {
  await button.handlers.click({ preventDefault() {} });
  assert.equal(patchCalls.length, 1, 'save should call PATCH even while initial GET is pending');
  assert.equal(patchCalls[0].documentType, 'commercial_invoice', 'missing GSTIN must select the safe non-GST document type');
  assert.equal(patchCalls[0].legalName, '', 'legal name remains optional for non-GST commercial records');
  assert.equal(patchCalls[0].businessAddress, '', 'invoice address override remains optional when Store Profile has the address');
  assert.equal(patchCalls[0].gstin, '');
  assert.equal(element('invoiceEnabled').checked, true, 'non-GST invoice issuance can enable without duplicate legal fields');
  assert.match(element('invoiceSettingsStatus').textContent, /non-GST commercial/);

  resolveGet({ invoiceSettings: {
    enabled: false, documentType: 'commercial_invoice', legalName: '',
    businessAddress: '', stateName: '', stateCode: '', gstin: '',
    seriesPrefix: 'FW', footer: '', pricesIncludeTax: true
  }});
  await loading;
  assert.equal(element('invoiceLegalName').value, '', 'late initial GET must not erase saved settings');
  assert.equal(element('invoiceBusinessAddress').value, '');
  assert.equal(element('invoiceFooter').value, 'Keep this footer');

  // Exercise the exact reported failure mode: the settings-specific API has
  // not been registered, but the shared authenticated Owner API is available.
  sandbox.window.FreshWayOwnerInvoiceSettingsApi = undefined;
  sandbox.window.api = api;
  await button.handlers.click({ preventDefault() {} });
  assert.equal(patchCalls.length, 2, 'Save must fall back to window.api when the module-specific API is missing');
  console.log('Owner invoice save button API fallback and async-binding regression OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
