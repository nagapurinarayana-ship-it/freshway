const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('admin.html', 'utf8');
const adminSource = fs.readFileSync('admin.js', 'utf8');
const source = fs.readFileSync('frontend/admin/invoice-settings.js', 'utf8');
assert.match(html, /admin\.js\?v=20261022-invoice-api-fallback-v2/);
assert.match(html, /frontend\/admin\/invoice-settings\.js\?v=20261022-invoice-api-fallback-v2/);
assert.match(adminSource, /FreshWayOwnerInvoiceSettings\)loads\.push\(window\.FreshWayOwnerInvoiceSettings\.load\(\{api\}\)\)/);
assert.match(adminSource, /await Promise\.all\(loads\)/);
assert.match(source, /window\.FreshWayOwnerInvoiceSettingsApi\|\|window\.api/, 'Save must fall back to the shared Owner API if the settings loader has not registered its API yet');

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
    enabled: false, documentType: 'gst_tax_invoice', legalName: 'FreshWay Foods',
    businessAddress: 'Shop 1, Main Road', stateName: 'Telangana', stateCode: '36',
    gstin: '', seriesPrefix: 'FW', footer: 'Keep this footer', pricesIncludeTax: true,
    enableWarning: 'Enter a valid 15-character GSTIN.'
  }});
};

const loading = sandbox.window.FreshWayOwnerInvoiceSettings.load({ api });
element('invoiceEnabled').checked = true;
element('invoiceEnabled').handlers.change();
element('invoiceDocumentType').value = 'gst_tax_invoice';
element('invoiceDocumentType').handlers.change();
element('invoiceLegalName').value = 'FreshWay Foods';
element('invoiceLegalName').handlers.input();
element('invoiceBusinessAddress').value = 'Shop 1, Main Road';
element('invoiceBusinessAddress').handlers.input();
element('invoiceStateName').value = 'Telangana';
element('invoiceStateName').handlers.input();
element('invoiceStateCode').value = '36';
element('invoiceStateCode').handlers.input();
element('invoiceFooter').value = 'Keep this footer';
element('invoiceFooter').handlers.input();

(async () => {
  await button.handlers.click({ preventDefault() {} });
  assert.equal(patchCalls.length, 1, 'save should call PATCH even while initial GET is pending');
  assert.equal(patchCalls[0].legalName, 'FreshWay Foods');
  assert.equal(patchCalls[0].businessAddress, 'Shop 1, Main Road');
  assert.equal(patchCalls[0].gstin, '');
  assert.equal(element('invoiceEnabled').checked, false, 'invalid incomplete setup must stay disabled');
  assert.match(element('invoiceSettingsStatus').textContent, /Details saved/);

  resolveGet({ invoiceSettings: {
    enabled: false, documentType: 'commercial_invoice', legalName: '',
    businessAddress: '', stateName: '', stateCode: '', gstin: '',
    seriesPrefix: 'FW', footer: '', pricesIncludeTax: true
  }});
  await loading;
  assert.equal(element('invoiceLegalName').value, 'FreshWay Foods', 'late initial GET must not erase saved settings');
  assert.equal(element('invoiceBusinessAddress').value, 'Shop 1, Main Road');
  assert.equal(element('invoiceFooter').value, 'Keep this footer');

  // Exercise the exact reported failure mode: the settings-specific API has
  // not been registered, but the shared authenticated Owner API is available.
  sandbox.window.FreshWayOwnerInvoiceSettingsApi = undefined;
  sandbox.window.api = api;
  await button.handlers.click({ preventDefault() {} });
  assert.equal(patchCalls.length, 2, 'Save must fall back to window.api when the module-specific API is missing');
  console.log('Owner invoice save button API fallback and async-binding regression OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
