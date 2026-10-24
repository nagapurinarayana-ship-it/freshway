import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAddress } from '../src/address-api.js';

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() { return this.db.first(this.sql, this.params); }
  async all() { return this.db.all(this.sql, this.params); }
  async run() { return this.db.run(this.sql, this.params); }
}

class MockD1 {
  constructor() { this.rows = []; this.nextId = 1; this.failBatchAfterFirst = false; }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    const savedRows = this.rows.map(row => ({ ...row }));
    const savedNextId = this.nextId;
    try {
      const results = [];
      for (let index = 0; index < statements.length; index++) {
        if (this.failBatchAfterFirst && index === 1) {
          this.failBatchAfterFirst = false;
          throw new Error('simulated D1 batch failure');
        }
        results.push(await statements[index].run());
      }
      return results;
    } catch (error) {
      this.rows = savedRows;
      this.nextId = savedNextId;
      this.failBatchAfterFirst = false;
      throw error;
    }
  }
  ownedRows(customerId) {
    return this.rows.filter(row => String(row.customer_id) === String(customerId) && !row.deleted_at);
  }
  async first(sql, p) {
    if (sql.includes('LOWER(TRIM(label))')) {
      const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      return this.ownedRows(p[0]).filter(row =>
        normalize(row.label) === normalize(p[1]) &&
        normalize(row.recipient_name) === normalize(p[2]) &&
        row.delivery_phone === p[3] &&
        normalize(row.house) === normalize(p[4]) &&
        normalize(row.building) === normalize(p[5]) &&
        normalize(row.floor) === normalize(p[6]) &&
        normalize(row.street) === normalize(p[7]) &&
        normalize(row.area) === normalize(p[8]) &&
        normalize(row.locality) === normalize(p[9]) &&
        normalize(row.city) === normalize(p[10]) &&
        normalize(row.district) === normalize(p[11]) &&
        normalize(row.state) === normalize(p[12]) &&
        normalize(row.pincode) === normalize(p[13])
      ).sort((a, b) => Number(b.is_default) - Number(a.is_default) || b.id - a.id)
       .map(row => ({ id: row.id }))[0] || null;
    }
    if (sql.includes('SELECT id FROM addresses WHERE id=? AND customer_id=? AND deleted_at IS NULL')) {
      return this.rows.find(row => row.id === Number(p[0]) && String(row.customer_id) === String(p[1]) && !row.deleted_at)
        ? { id: Number(p[0]) } : null;
    }
    if (sql.includes('SELECT * FROM addresses WHERE id=? AND customer_id=?')) {
      return this.rows.find(row => row.id === Number(p[0]) && String(row.customer_id) === String(p[1]) && !row.deleted_at) || null;
    }
    if (sql.includes('is_default=1 ORDER BY id DESC LIMIT 1')) {
      return this.ownedRows(p[0]).filter(row => Number(row.is_default) === 1).sort((a, b) => b.id - a.id).map(row => ({ id: row.id }))[0] || null;
    }
    if (sql.includes('SELECT id FROM addresses WHERE customer_id=?')) {
      return this.ownedRows(p[0]).sort((a, b) => b.id - a.id).map(row => ({ id: row.id }))[0] || null;
    }
    throw new Error('Unhandled first() query: ' + sql);
  }
  async all(sql, p) {
    if (sql.includes('SELECT * FROM addresses WHERE customer_id=?')) {
      return { results: this.ownedRows(p[0]).sort((a, b) => Number(b.is_default) - Number(a.is_default) || b.id - a.id) };
    }
    throw new Error('Unhandled all() query: ' + sql);
  }
  async run(sql, p) {
    if (sql.includes('SET is_default=CASE WHEN id=COALESCE(')) {
      const preferredId = p[0] == null ? null : Number(p[0]);
      const preferredCustomer = String(p[1]);
      const defaultCustomer = String(p[2]);
      const fallbackCustomer = String(p[3]);
      const whereCustomer = String(p[4]);
      const rows = this.ownedRows(whereCustomer).sort((a, b) => b.id - a.id);
      let chosen = preferredId == null ? null : rows.find(row =>
        row.id === preferredId && String(row.customer_id) === preferredCustomer
      );
      if (!chosen) chosen = rows.find(row =>
        String(row.customer_id) === defaultCustomer && Number(row.is_default) === 1
      );
      if (!chosen) chosen = rows.find(row => String(row.customer_id) === fallbackCustomer) || null;
      for (const row of rows) row.is_default = chosen && row.id === chosen.id ? 1 : 0;
      return { meta: { changes: rows.length } };
    }
    if (sql.startsWith('INSERT INTO addresses')) {
      const row = {
        id: this.nextId++, customer_id: p[0], house: p[1], area: p[2], city: p[3],
        pincode: p[4], landmark: p[5], note: p[6], label: p[7], recipient_name: p[8],
        delivery_phone: p[9], building: p[10], floor: p[11], street: p[12], locality: p[13],
        district: p[14], state: p[15], latitude: p[16], longitude: p[17], accuracy_meters: p[18],
        location_source: p[19], place_id: p[20], location_updated_at: p[21], is_default: p[22], deleted_at: null
      };
      this.rows.push(row);
      return { meta: { last_row_id: row.id, changes: 1 } };
    }
    if (sql.includes('SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END')) {
      this.ownedRows(p[1]).forEach(row => { row.is_default = row.id === Number(p[0]) ? 1 : 0; });
      return { meta: { changes: 1 } };
    }
    if (sql.includes('SET is_default=0,deleted_at=CURRENT_TIMESTAMP')) {
      const row = this.rows.find(item => item.id === Number(p[0]) && String(item.customer_id) === String(p[1]) && !item.deleted_at);
      if (row) { row.is_default = 0; row.deleted_at = 'deleted'; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('SET is_default=0 WHERE customer_id=?')) {
      this.ownedRows(p[0]).forEach(row => { row.is_default = 0; });
      return { meta: { changes: 1 } };
    }
    if (sql.includes('SET is_default=1 WHERE id=? AND customer_id=?')) {
      const row = this.rows.find(item => item.id === Number(p[0]) && String(item.customer_id) === String(p[1]) && !item.deleted_at);
      if (row) row.is_default = 1;
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.startsWith('UPDATE addresses SET label=?')) {
      const id = Number(p[22]), customerId = String(p[23]);
      const row = this.rows.find(item => item.id === id && String(item.customer_id) === customerId && !item.deleted_at);
      if (!row) return { meta: { changes: 0 } };
      Object.assign(row, {
        label:p[0], recipient_name:p[1], delivery_phone:p[2], house:p[3], building:p[4],
        floor:p[5], street:p[6], area:p[7], locality:p[8], city:p[9], district:p[10],
        state:p[11], pincode:p[12], landmark:p[13], note:p[14], latitude:p[15],
        longitude:p[16], accuracy_meters:p[17], location_source:p[18], place_id:p[19],
        location_updated_at:p[20], is_default:p[21]
      });
      return { meta: { changes: 1 } };
    }
    throw new Error('Unhandled run() query: ' + sql);
  }
}

function address(overrides = {}) {
  return {
    label: 'Home', recipientName: 'Test Customer', deliveryPhone: '9876543210',
    houseFlat: '1-2-3', building: 'Lake View', floor: '2', street: 'Main Road',
    area: 'Green Colony', locality: 'Boduppal', city: 'Hyderabad',
    district: 'Medchal', state: 'Telangana', pincode: '500092',
    landmark: '', note: '', latitude: 17.4, longitude: 78.5,
    accuracyMeters: 20, locationSource: 'GPS', placeId: 'test-place',
    locationUpdatedAt: '2026-10-20T00:00:00.000Z', isDefault: false, ...overrides
  };
}
const env = () => ({ DB: new MockD1(), APP_ORIGIN: 'https://fwcoldpressed.in' });
const request = (url, method, data) => new Request('https://fwcoldpressed.in' + url, {
  method, headers: data === undefined ? {} : { 'content-type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data)
});
const result = async response => ({ status: response.status, body: await response.json() });

test('the first saved address becomes default automatically', async () => {
  const environment = env();
  const saved = await result(await handleAddress(request('/api/addresses', 'POST', address()), environment, 'customer-a', 'create'));
  assert.equal(saved.status, 201);
  assert.equal(saved.body.addresses.length, 1);
  assert.equal(saved.body.addresses[0].isDefault, true);
});

test('adding a second address does not replace the saved default', async () => {
  const environment = env();
  await handleAddress(request('/api/addresses', 'POST', address()), environment, 'customer-a', 'create');
  const second = address({ label: 'Work', houseFlat: 'Suite 8', area: 'Business Park', pincode: '500081', latitude: 17.42, longitude: 78.51, isDefault: false });
  const saved = await result(await handleAddress(request('/api/addresses', 'POST', second), environment, 'customer-a', 'create'));
  assert.equal(saved.status, 201);
  assert.equal(saved.body.addresses.filter(item => item.isDefault).length, 1);
  assert.equal(saved.body.addresses.find(item => item.label === 'Home').isDefault, true);
  assert.equal(saved.body.addresses.find(item => item.label === 'Work').isDefault, false);
});

test('saving a duplicate without an explicit default request cannot switch the default', async () => {
  const environment = env();
  await handleAddress(request('/api/addresses', 'POST', address()), environment, 'customer-a', 'create');
  await handleAddress(request('/api/addresses', 'POST', address({ label: 'Work', houseFlat: 'Suite 8', area: 'Business Park', pincode: '500081', latitude: 17.42, longitude: 78.51 })), environment, 'customer-a', 'create');
  const duplicate = address({ latitude: 17.40002, longitude: 78.50002, locationUpdatedAt: '2026-10-20T00:02:00.000Z' });
  const saved = await result(await handleAddress(request('/api/addresses', 'POST', duplicate), environment, 'customer-a', 'create'));
  assert.equal(saved.body.deduplicated, true);
  assert.equal(saved.body.addresses.filter(item => item.isDefault).length, 1);
  assert.equal(saved.body.addresses.find(item => item.label === 'Home').isDefault, true);
});

test('making another address default and deleting it always leaves one default', async () => {
  const environment = env();
  const first = await result(await handleAddress(request('/api/addresses', 'POST', address()), environment, 'customer-a', 'create'));
  const second = await result(await handleAddress(request('/api/addresses', 'POST', address({ label: 'Work', houseFlat: 'Suite 8', area: 'Business Park', pincode: '500081', latitude: 17.42, longitude: 78.51 })), environment, 'customer-a', 'create'));
  const workId = second.body.id;
  const changed = await result(await handleAddress(request('/api/addresses/' + workId, 'PATCH', { default: true }), environment, 'customer-a', 'update'));
  assert.equal(changed.body.addresses.filter(item => item.isDefault).length, 1);
  assert.equal(changed.body.addresses.find(item => item.id === workId).isDefault, true);
  const deleted = await result(await handleAddress(request('/api/addresses/' + workId, 'DELETE'), environment, 'customer-a', 'delete'));
  assert.equal(deleted.body.addresses.length, 1);
  assert.equal(deleted.body.addresses[0].isDefault, true);
  assert.equal(deleted.body.addresses[0].id, first.body.id);
});

test('address lists never expose another customer account address', async () => {
  const environment = env();
  await handleAddress(request('/api/addresses', 'POST', address()), environment, 'customer-a', 'create');
  await handleAddress(request('/api/addresses', 'POST', address({ label: 'Home', recipientName: 'Second Customer', deliveryPhone: '9123456789', houseFlat: '9-9-9' })), environment, 'customer-b', 'create');
  const list = await result(await handleAddress(request('/api/addresses', 'GET'), environment, 'customer-a', 'list'));
  assert.equal(list.body.addresses.length, 1);
  assert.equal(list.body.addresses[0].recipientName, 'Test Customer');
});