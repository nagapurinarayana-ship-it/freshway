import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceabilityZone } from '../src/serviceability.js';

function fakeD1() {
  const state = {
    settings: { id: 1, enforcement_mode: 'off', config_version: 1, updated_at: 'now' },
    zones: [],
    audit: []
  };
  function statement(sql, args = []) {
    return {
      sql, args,
      bind(...nextArgs) { return statement(sql, nextArgs); },
      async first() {
        if (sql.includes('FROM serviceability_settings')) return { ...state.settings };
        if (sql.includes('FROM delivery_zones WHERE id=?')) return state.zones.find(z => z.id === args[0]) || null;
        throw new Error('Unexpected first query: ' + sql);
      },
      async all() {
        if (sql.includes('FROM delivery_zones')) return { results: state.zones.map(z => ({ ...z })) };
        throw new Error('Unexpected all query: ' + sql);
      }
    };
  }
  return {
    state,
    prepare: statement,
    async batch(statements) {
      assert.ok(Array.isArray(statements));
      assert.ok(statements.every(item => item && typeof item.then !== 'function' && typeof item.sql === 'string'),
        'D1 batch must receive prepared statements, never unresolved Promises');
      for (const item of statements) {
        const a = item.args;
        if (item.sql.startsWith('INSERT INTO delivery_zones')) {
          state.zones.push({
            id: a[0], name: a[1], customer_label: a[2], coverage_mode: a[3],
            status: a[4], priority: a[5], pin_codes_json: a[6], polygon_geojson: a[7],
            allow_pin_fallback: a[8], unavailable_message: a[9], internal_note: a[10],
            created_at: 'now', updated_at: 'now'
          });
        } else if (item.sql.startsWith('UPDATE serviceability_settings SET config_version=config_version+1')) {
          state.settings.config_version += 1;
        } else if (item.sql.startsWith('INSERT INTO serviceability_audit')) {
          state.audit.push(a);
        }
      }
      return statements.map(() => ({ success: true }));
    }
  };
}

test('creating a delivery zone batches real D1 prepared statements and records audit/version', async () => {
  const DB = fakeD1();
  const result = await createServiceabilityZone({ DB }, {
    name: 'Initial test zone',
    coverageMode: 'pincode',
    status: 'draft',
    pinCodes: [],
    priority: 0
  });
  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0].name, 'Initial test zone');
  assert.equal(result.zones[0].status, 'draft');
  assert.equal(result.settings.configVersion, 2);
  assert.equal(DB.state.audit.length, 1);
});
