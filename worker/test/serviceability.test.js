import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ServiceabilityError,
  normalizeDestination,
  normalizePolygon,
  pointInServicePolygon,
  evaluateZones,
  checkServiceability
} from '../src/serviceability.js';

const square = {
  type: 'Polygon',
  coordinates: [[[79,17],[79.1,17],[79.1,17.1],[79,17.1],[79,17]]]
};
const squareWithHole = {
  type: 'Polygon',
  coordinates: [
    [[79,17],[79.1,17],[79.1,17.1],[79,17.1],[79,17]],
    [[79.03,17.03],[79.07,17.03],[79.07,17.07],[79.03,17.07],[79.03,17.03]]
  ]
};
const zone = (id, patch = {}) => ({
  id, name: id, customerLabel: '', coverageMode: 'pincode', status: 'active',
  priority: 0, pinCodes: ['504001'], polygon: null, allowPinFallback: false,
  unavailableMessage: '', internalNote: '', ...patch
});
const row = value => ({
  id: value.id, name: value.name, customer_label: value.customerLabel,
  coverage_mode: value.coverageMode, status: value.status, priority: value.priority,
  pin_codes_json: JSON.stringify(value.pinCodes), polygon_geojson: value.polygon ? JSON.stringify(value.polygon) : null,
  allow_pin_fallback: value.allowPinFallback ? 1 : 0, unavailable_message: value.unavailableMessage,
  internal_note: value.internalNote, created_at: null, updated_at: null
});
function envFor(mode, zones = []) {
  return { DB: { prepare(sql) {
    return {
      async first() {
        if (sql.includes('FROM serviceability_settings')) return { id: 1, enforcement_mode: mode, config_version: 7 };
        throw new Error('Unexpected first query: ' + sql);
      },
      async all() {
        if (sql.includes('FROM delivery_zones')) return { results: zones.map(row) };
        throw new Error('Unexpected all query: ' + sql);
      }
    };
  } } };
}

test('destination validation requires complete coordinate pairs and valid PIN codes', () => {
  assert.deepEqual(normalizeDestination({pincode:'504001'}), {pincode:'504001',accuracyMeters:null});
  assert.throws(() => normalizeDestination({pincode:'50401'}), ServiceabilityError);
  assert.throws(() => normalizeDestination({latitude:17.6}), /incomplete/i);
  assert.throws(() => normalizeDestination({latitude:999,longitude:79.1}), /invalid/i);
  assert.throws(() => normalizeDestination({latitude:0,longitude:0}), /invalid/i);
});

test('polygon accepts valid closed GeoJSON and rejects malformed, unclosed and self-crossing rings', () => {
  assert.equal(normalizePolygon(square).type, 'Polygon');
  assert.throws(() => normalizePolygon({type:'Point',coordinates:[79,17]}), /Polygon and MultiPolygon/i);
  assert.throws(() => normalizePolygon({type:'Polygon',coordinates:[[[79,17],[79.1,17],[79.1,17.1],[79,17.1]]]}), /closed/i);
  const crossed = {type:'Polygon',coordinates:[[[79,17],[79.1,17.1],[79,17.1],[79.1,17],[79,17]]]};
  assert.throws(() => normalizePolygon(crossed), /crosses itself/i);
});

test('point-in-polygon includes the outer boundary and excludes points outside and inside holes', () => {
  assert.equal(pointInServicePolygon(17.05,79.05,square), true);
  assert.equal(pointInServicePolygon(17,79.05,square), true, 'outer boundary counts as inside');
  assert.equal(pointInServicePolygon(17.2,79.05,square), false);
  assert.equal(pointInServicePolygon(17.05,79.05,squareWithHole), false);
  assert.equal(pointInServicePolygon(17.02,79.02,squareWithHole), true);
});

test('MultiPolygon matches a point inside any component', () => {
  const multi = {type:'MultiPolygon',coordinates:[square.coordinates, [[[80,18],[80.1,18],[80.1,18.1],[80,18.1],[80,18]]]]};
  assert.equal(pointInServicePolygon(18.05,80.05,multi), true);
  assert.equal(pointInServicePolygon(17.05,79.05,multi), true);
  assert.equal(pointInServicePolygon(19,81,multi), false);
});

test('PIN zones match by PIN even when coordinates are supplied', () => {
  const result = evaluateZones([zone('pin')], {pincode:'504001',latitude:17.5,longitude:79.5});
  assert.equal(result.serviceable,true);
  assert.equal(result.matchType,'pincode');
});

test('polygon zone requires coordinates and never infers coverage from a PIN', () => {
  const result = evaluateZones([zone('poly',{coverageMode:'polygon',pinCodes:[],polygon:square})], {pincode:'504001'});
  assert.equal(result.serviceable,false);
  assert.equal(result.code,'OUTSIDE_SERVICE_AREA');
  assert.equal(evaluateZones([zone('poly',{coverageMode:'polygon',pinCodes:[],polygon:square})],{latitude:17.05,longitude:79.05}).serviceable,true);
});

test('hybrid PIN fallback only applies when coordinates are absent', () => {
  const hybrid = zone('hybrid',{coverageMode:'hybrid',polygon:square,allowPinFallback:true});
  assert.equal(evaluateZones([hybrid],{pincode:'504001'}).matchType,'pincode_fallback');
  assert.equal(evaluateZones([hybrid],{pincode:'504001',latitude:17.5,longitude:79.5}).serviceable,false);
  assert.equal(evaluateZones([hybrid],{pincode:'504001',latitude:17.05,longitude:79.05}).matchType,'polygon');
});

test('highest priority wins, with stable zone ID tie-break, among active matches', () => {
  const result = evaluateZones([zone('z-low',{priority:1}),zone('z-high',{priority:4}),zone('a-tie',{priority:4})],{pincode:'504001'});
  assert.equal(result.zone.id,'a-tie');
});

test('active service wins over a paused overlapping zone; paused-only match is reported as paused', () => {
  const active = zone('active',{priority:1});
  const paused = zone('paused',{status:'paused',priority:99,unavailableMessage:'Paused today'});
  assert.equal(evaluateZones([paused,active],{pincode:'504001'}).zone.id,'active');
  const result = evaluateZones([paused],{pincode:'504001'});
  assert.equal(result.code,'ZONE_PAUSED');
  assert.equal(result.serviceable,false);
  assert.equal(result.message,'Paused today');
});

test('off mode preserves legacy order behaviour without reading zones', async () => {
  const env = {DB:{prepare(sql){return {async first(){return {enforcement_mode:'off',config_version:3}},async all(){throw new Error('Zones must not be read in off mode')}}}}};
  const result = await checkServiceability(env,{pincode:'000000'});
  assert.equal(result.mode,'off');
  assert.equal(result.orderAllowed,true);
  assert.equal(result.serviceable,null);
});

test('shadow computes misses but never blocks an order', async () => {
  const result = await checkServiceability(envFor('shadow',[zone('pin')]),{pincode:'999999'});
  assert.equal(result.serviceable,false);
  assert.equal(result.orderAllowed,true);
  assert.equal(result.code,'OUTSIDE_SERVICE_AREA');
});

test('enforced mode blocks uncovered addresses and passes matching active zones', async () => {
  const env = envFor('enforced',[zone('pin')]);
  const denied = await checkServiceability(env,{pincode:'999999'});
  assert.equal(denied.orderAllowed,false);
  assert.equal(denied.code,'OUTSIDE_SERVICE_AREA');
  const allowed = await checkServiceability(env,{pincode:'504001'});
  const rawRowsDecision = evaluateZones([row(zone('pin'))],{pincode:'504001'});
  assert.equal(rawRowsDecision.serviceable,true, JSON.stringify(rawRowsDecision));
  assert.equal(allowed.orderAllowed,true, JSON.stringify(allowed));
  assert.equal(allowed.zone.id,'pin');
});

test('enforced mode fails closed if no active zones exist', async () => {
  const result = await checkServiceability(envFor('enforced',[]),{pincode:'504001'});
  assert.equal(result.orderAllowed,false);
  assert.equal(result.code,'NO_ACTIVE_ZONES');
});
