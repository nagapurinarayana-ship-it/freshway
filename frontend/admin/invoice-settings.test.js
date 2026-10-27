const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('admin.html', 'utf8');
const adminSource = fs.readFileSync('admin.js', 'utf8');
const source = fs.readFileSync('frontend/admin/invoice-settings.js', 'utf8');
assert.match(html, /admin\.js\?v=20261027-navigation-boot-guard-v1/);
assert.match(html, /frontend\/admin\/invoice-settings\.js\?v=20261023-available-fields-invoice-v2/);
assert.match(adminSource, /FreshWayOwnerInvoiceSettings\)loads\.push\(window\.FreshWayOwnerInvoiceSettings\.load\(\{api\}\)\)/);
assert.match(adminSource, /await Promise\.all\(loads\)/);
assert.match(source, /window\.FreshWayOwnerInvoiceSettingsApi\|\|window\.api/, 'Save must fall back to the shared Owner API if the settings loader has not registered its API yet');
assert.ok(html.includes('id="invoiceBackfillBtn"'), 'Owner Settings must expose an explicit retry for missing invoices');
assert.match(source, /\/admin\/invoices\/backfill/, 'retry action must call the authenticated backfill endpoint');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const checked = id === 'invoicePricesIncludeTax';
    elements.set(id, {
      id, value: id === 'invoiceSeriesPrefix' ? 'FW' : (id === 'invoiceDocumentType' ? 'commercial_invoice' : ''),
      checked, disabled: false, hidden: false, dataset: {}, handlers: {},
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
assert.equal(typeof element('invoiceBackfillBtn').handlers.click, 'function', 'missing-invoice retry button must be wired immediately');

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
assert.equal(element('invoiceGstinLabel').textContent, 'GSTIN (required for this document type)');
assert.equal(sandbox.window.FreshWayOwnerInvoiceSettings.hasUnsavedChanges(), true, 'billing field edits are tracked as unsaved');
assert.equal(element('invoiceSettingsTaxNoteTitle').textContent, 'GST document requirements:');
assert.match(element('invoiceSettingsTaxNoteText').textContent, /valid product HSN codes/);
assert.match(element('invoiceSettingsTaxNoteText').textContent, /will not guess missing tax details/);
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
  assert.equal(sandbox.window.FreshWayOwnerInvoiceSettings.hasUnsavedChanges(), false, 'server-confirmed save clears the unsaved flag');
  assert.equal(element('invoiceGstinLabel').textContent, 'Tax number (optional; printed if provided)');
  assert.equal(element('invoiceSettingsTaxNoteTitle').textContent, 'Commercial receipt note:');
  assert.match(element('invoiceSettingsTaxNoteText').textContent, /does not trigger GST calculations/);

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
  element('invoiceDocumentType').value = 'commercial_invoice';
  element('invoiceGstin').value = '36AEXFS4597F1Z6';
  element('invoiceGstin').handlers.input();
  await button.handlers.click({ preventDefault() {} });
  assert.equal(patchCalls.length, 3, 'commercial receipt settings must save when the optional tax number is present');
  assert.equal(patchCalls[2].documentType, 'commercial_invoice');
  assert.equal(patchCalls[2].gstin, '36AEXFS4597F1Z6');
  console.log('Owner invoice save button API fallback and async-binding regression OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
