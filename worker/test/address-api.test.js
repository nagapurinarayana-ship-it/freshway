import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAddress, validateAddressPayload } from '../src/address-api.js';

const makeAddress = (overrides = {}) => ({
  id: 7, customer_id: 'customer-1', is_saved: 1, deleted_at: null,
  house: '12', area: 'Boduppal', city: 'Hyderabad', pincode: '500092',
  landmark: '', note: '', label: 'Home', recipient_name: 'Customer Name',
  delivery_phone: '919876543210', building: '', floor: '', street: '',
  locality: '', district: '', state: 'Telangana', latitude: 17.41,
  longitude: 78.57, accuracy_meters: 12, location_source: 'GPS',
  place_id: '', location_updated_at: '2026-10-19T10:00:00.000Z',
  is_default: 0, ...overrides
});

function mockDb({ rows = [], duplicate = null } = {}) {
  const calls = [];
  let nextId = Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1;
  const active = [...rows];
  function record(sql, params, method) { calls.push({ sql, params, method }); }
  async function execute(sql, params = []) {
    record(sql, params, 'run');
    if (/UPDATE addresses SET is_default=0 WHERE customer_id=\?/.test(sql)) {
      for (const row of active) if (row.customer_id === params[0] && row.is_saved === 1 && !row.deleted_at) row.is_default = 0;
      return { meta: { changes: 1 } };
    }
    if (/UPDATE addresses SET is_default=1 WHERE id=\? AND customer_id=\?/.test(sql)) {
      const row = active.find(item => Number(item.id) === Number(params[0]) && item.customer_id === params[1] && item.is_saved === 1 && !item.deleted_at);
      if (row) row.is_default = 1;
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (/UPDATE addresses SET is_default=0,deleted_at=CURRENT_TIMESTAMP/.test(sql)) {
      const row = active.find(item => Number(item.id) === Number(params[0]) && item.customer_id === params[1]);
      if (row) { row.is_default = 0; row.deleted_at = 'now'; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (/INSERT INTO addresses/.test(sql)) {
      const p = params, id = nextId++;
      active.push(makeAddress({
        id, customer_id: p[0], house: p[1], area: p[2], city: p[3], pincode: p[4],
        landmark: p[5], note: p[6], label: p[7], recipient_name: p[8],
        delivery_phone: p[9], building: p[10], floor: p[11], street: p[12],
        locality: p[13], district: p[14], state: p[15], latitude: p[16],
        longitude: p[17], accuracy_meters: p[18], location_source: p[19],
        place_id: p[20], location_updated_at: p[21], is_default: p[22], is_saved: 1
      }));
      return { meta: { last_row_id: id, changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
  const db = {
    calls, rows: active,
    prepare(sql) {
      const statement = {
        sql, params: [],
        bind(...params) { this.params = params; return this; },
        async all() {
          record(sql, this.params, 'all');
          if (/SELECT \* FROM addresses WHERE customer_id=\? AND is_saved=1/.test(sql)) {
            return { results: active.filter(row => row.customer_id === this.params[0] && row.is_saved === 1 && !row.deleted_at).sort((a,b) => Number(b.is_default)-Number(a.is_default) || Number(b.id)-Number(a.id)) };
          }
          return { results: [] };
        },
        async first() {
          record(sql, this.params, 'first');
          if (/SELECT id FROM addresses WHERE customer_id=\? AND is_saved=1 AND deleted_at IS NULL AND label=\?/.test(sql)) return duplicate;
          if (/is_default=1 ORDER BY id DESC LIMIT 1/.test(sql)) return active.find(row => row.customer_id === this.params[0] && row.is_saved === 1 && !row.deleted_at && row.is_default === 1) || null;
          if (/ORDER BY id DESC LIMIT 1/.test(sql)) {
            return active.filter(row => row.customer_id === this.params[0] && row.is_saved === 1 && !row.deleted_at).sort((a,b)=>Number(b.id)-Number(a.id))[0] || null;
          }
          if (/SELECT \* FROM addresses WHERE id=\?/.test(sql)) return active.find(row => Number(row.id)===Number(this.params[0]) && row.customer_id===this.params[1] && row.is_saved===1 && !row.deleted_at) || null;
          return null;
        },
        async run() { return execute(sql, this.params); }
      };
      return statement;
    },
    async batch(statements) {
      const result = [];
      for (const statement of statements) result.push(await execute(statement.sql, statement.params));
      return result;
    }
  };
  return db;
}

const env = DB => ({ DB, APP_ORIGIN: 'https://fwcoldpressed.in' });

test('address validation requires valid coordinates and a full delivery contact', () => {
  const base = {
    recipientName: 'Customer Name', deliveryPhone: '9876543210',
    houseFlat: '12', area: 'Boduppal', city: 'Hyderabad', pincode: '500092'
  };
  assert.match(validateAddressPayload(base), /exact delivery location/i);
  assert.match(validateAddressPayload({ ...base, latitude: 17.41, longitude: '' }), /exact delivery location/i);
  assert.match(validateAddressPayload({ ...base, latitude: 100, longitude: 78.57 }), /invalid/i);
  assert.equal(validateAddressPayload({ ...base, latitude: 17.41, longitude: 78.57 }), '');
});

test('saved-address listing excludes order-only address rows', async () => {
  const DB = mockDb({ rows: [
    makeAddress({ id: 8, is_saved: 1, is_default: 1 }),
    makeAddress({ id: 9, is_saved: 0, is_default: 0, house: 'Order-only address' })
  ] });
  const response = await handleAddress(new Request('https://fwcoldpressed.in/api/addresses'), env(DB), 'customer-1', 'list');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.addresses.map(address => address.id), [8]);
  assert.ok(DB.calls.some(call => /SELECT \* FROM addresses WHERE customer_id=\? AND is_saved=1/.test(call.sql)));
});

test('POST /api/addresses creates a saved address without requiring an ID first', async () => {
  const DB = mockDb();
  const response = await handleAddress(new Request('https://fwcoldpressed.in/api/addresses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Home', recipientName: 'Customer Name', deliveryPhone: '9876543210',
      houseFlat: '12', area: 'Boduppal', city: 'Hyderabad', state: 'Telangana',
      pincode: '500092', latitude: 17.41, longitude: 78.57, isDefault: false
    })
  }), env(DB), 'customer-1', 'create');
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.id, 1);
  assert.equal(data.addresses.length, 1);
  assert.equal(data.addresses[0].isDefault, true);
  assert.ok(DB.calls.some(call => /INSERT INTO addresses/.test(call.sql) && /is_saved/.test(call.sql)));
});

test('saving a duplicate non-default address does not unexpectedly promote it over the current default', async () => {
  const DB = mockDb({
    rows: [makeAddress({ id: 3 }), makeAddress({ id: 9, is_default: 1, label: 'Work' })],
    duplicate: { id: 3 }
  });
  const response = await handleAddress(new Request('https://fwcoldpressed.in/api/addresses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Home', recipientName: 'Customer Name', deliveryPhone: '9876543210',
      houseFlat: '12', area: 'Boduppal', city: 'Hyderabad', pincode: '500092',
      latitude: 17.41, longitude: 78.57, isDefault: false
    })
  }), env(DB), 'customer-1', 'create');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.deduplicated, true);
  assert.equal(data.id, 3);
  assert.equal(DB.rows.find(row => row.id === 9).is_default, 1);
  assert.ok(!DB.calls.some(call => /UPDATE addresses SET is_default=1 WHERE id=\?/.test(call.sql)), 'duplicate non-default must not be made default');
});
