const MODES = new Set(['off', 'shadow', 'enforced']);
const ZONE_STATUSES = new Set(['draft', 'active', 'paused', 'archived']);
const COVERAGE_MODES = new Set(['pincode', 'polygon', 'hybrid']);
const DEFAULT_UNAVAILABLE_MESSAGE = "Delivery isn't available at this location yet.";
const MAX_POLYGON_CHARS = 120000;
const MAX_POLYGON_VERTICES = 2000;
const MAX_RING_VERTICES = 500;

export class ServiceabilityError extends Error {
  constructor(message, status = 400, code = 'SERVICEABILITY_ERROR') {
    super(message);
    this.name = 'ServiceabilityError';
    this.status = status;
    this.code = code;
  }
}

const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const parseJson = (value, fallback) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; }
  catch (_) { return fallback; }
};

export function validCoordinates(latitude, longitude) {
  if (latitude == null || latitude === '' || longitude == null || longitude === '') return false;
  const lat = Number(latitude), lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
}

export function normalizeDestination(input = {}) {
  const rawPin = input.pincode ?? input.pinCode ?? input.pin_code ?? '';
  const pincode = String(rawPin ?? '').trim();
  if (pincode && !/^\d{6}$/.test(pincode)) {
    throw new ServiceabilityError('Enter a valid 6-digit PIN code.');
  }
  const latitude = input.latitude ?? input.lat ?? null;
  const longitude = input.longitude ?? input.lon ?? input.lng ?? null;
  const hasLatitude = latitude !== null && latitude !== '';
  const hasLongitude = longitude !== null && longitude !== '';
  if (hasLatitude !== hasLongitude) {
    throw new ServiceabilityError('The selected map location is incomplete. Please confirm the delivery pin.');
  }
  let coords = null;
  if (hasLatitude && hasLongitude) {
    if (!validCoordinates(latitude, longitude)) {
      throw new ServiceabilityError('The selected map location is invalid. Please confirm the delivery pin.');
    }
    coords = { latitude: Number(latitude), longitude: Number(longitude) };
  }
  const accuracyValue = input.accuracyMeters ?? input.accuracy_meters ?? null;
  let accuracyMeters = null;
  if (accuracyValue !== null && accuracyValue !== '') {
    accuracyMeters = Number(accuracyValue);
    if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 100000) {
      throw new ServiceabilityError('The selected location accuracy is invalid.');
    }
  }
  if (!pincode && !coords) {
    throw new ServiceabilityError('Enter a PIN code or confirm a delivery location on the map.');
  }
  return { pincode, ...(coords || {}), accuracyMeters };
}

function samePoint(a, b) {
  return Math.abs(Number(a[0]) - Number(b[0])) < 1e-10 &&
    Math.abs(Number(a[1]) - Number(b[1])) < 1e-10;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a, b, p) {
  return Math.abs(orient(a, b, p)) < 1e-10 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-10 && p[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-10 && p[1] <= Math.max(a[1], b[1]) + 1e-10;
}
function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (Math.abs(o1) < 1e-10 && onSegment(a, b, c)) ||
    (Math.abs(o2) < 1e-10 && onSegment(a, b, d)) ||
    (Math.abs(o3) < 1e-10 && onSegment(c, d, a)) ||
    (Math.abs(o4) < 1e-10 && onSegment(c, d, b));
}
function ringSelfIntersects(ring) {
  const edges = ring.length - 1;
  for (let i = 0; i < edges; i++) {
    for (let j = i + 1; j < edges; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === edges - 1)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

function validateRing(raw, context) {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > MAX_RING_VERTICES) {
    throw new ServiceabilityError(`${context} must have 4–${MAX_RING_VERTICES} coordinates, including the closing point.`);
  }
  const ring = raw.map(point => {
    if (!Array.isArray(point) || point.length < 2) throw new ServiceabilityError(`${context} contains an invalid coordinate.`);
    const lon = Number(point[0]), lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new ServiceabilityError(`${context} contains an out-of-range coordinate.`);
    }
    return [lon, lat];
  });
  if (!samePoint(ring[0], ring[ring.length - 1])) {
    throw new ServiceabilityError(`${context} must be a closed GeoJSON ring (first and last coordinates must match).`);
  }
  if (new Set(ring.slice(0, -1).map(point => point.join(','))).size < 3) {
    throw new ServiceabilityError(`${context} must contain at least three distinct vertices.`);
  }
  if (ringSelfIntersects(ring)) throw new ServiceabilityError(`${context} crosses itself. Please redraw the boundary.`);
  return ring;
}

export function normalizePolygon(value, { required = true } = {}) {
  if (value == null || value === '') {
    if (required) throw new ServiceabilityError('A valid map boundary is required for this coverage mode.');
    return null;
  }
  let input = value;
  if (typeof input === 'string') {
    if (input.length > MAX_POLYGON_CHARS) throw new ServiceabilityError('The map boundary is too large. Please simplify it.');
    input = parseJson(input, null);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServiceabilityError('Enter a valid GeoJSON Polygon or MultiPolygon.');
  }
  if (input.type !== 'Polygon' && input.type !== 'MultiPolygon') {
    throw new ServiceabilityError('Only GeoJSON Polygon and MultiPolygon boundaries are supported.');
  }
  const multi = input.type === 'Polygon' ? [input.coordinates] : input.coordinates;
  if (!Array.isArray(multi) || !multi.length || multi.length > 25) {
    throw new ServiceabilityError('The map boundary must contain 1–25 polygons.');
  }
  let totalVertices = 0;
  const polygons = multi.map((polygon, polygonIndex) => {
    if (!Array.isArray(polygon) || !polygon.length || polygon.length > 100) {
      throw new ServiceabilityError(`Polygon ${polygonIndex + 1} must contain an outer ring and valid holes.`);
    }
    return polygon.map((ring, ringIndex) => {
      const normalized = validateRing(ring, `Polygon ${polygonIndex + 1}, ring ${ringIndex + 1}`);
      totalVertices += normalized.length;
      if (totalVertices > MAX_POLYGON_VERTICES) throw new ServiceabilityError('The map boundary is too detailed. Please simplify it.');
      return normalized;
    });
  });
  return input.type === 'Polygon'
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function pointOnRing(point, ring) {
  for (let i = 0; i < ring.length - 1; i++) if (onSegment(ring[i], ring[i + 1], point)) return true;
  return false;
}
function pointInRing(point, ring) {
  if (pointOnRing(point, ring)) return true;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const crosses = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}
function pointInPolygon(point, polygon) {
  const rings = polygon.coordinates;
  if (!pointInRing(point, rings[0])) return false;
  // A hole is excluded, including its boundary.
  for (let i = 1; i < rings.length; i++) {
    if (pointOnRing(point, rings[i]) || pointInRing(point, rings[i])) return false;
  }
  return true;
}

export function pointInServicePolygon(latitude, longitude, polygonValue) {
  if (!validCoordinates(latitude, longitude)) return false;
  const polygon = normalizePolygon(polygonValue);
  const point = [Number(longitude), Number(latitude)];
  const polygons = polygon.type === 'Polygon' ? [polygon.coordinates] : polygon.coordinates;
  return polygons.some(rings => pointInPolygon(point, { type: 'Polygon', coordinates: rings }));
}

function pinsFromValue(value) {
  const raw = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(raw)) throw new ServiceabilityError('PIN codes must be supplied as a list.');
  if (raw.length > 1000) throw new ServiceabilityError('A zone cannot contain more than 1,000 PIN codes.');
  const pins = [];
  for (const entry of raw) {
    const pin = String(entry ?? '').trim();
    if (!/^\d{6}$/.test(pin)) throw new ServiceabilityError(`Invalid PIN code "${pin}". Each PIN code must contain exactly six digits.`);
    if (!pins.includes(pin)) pins.push(pin);
  }
  return pins;
}

function rowToZone(row) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    customerLabel: String(row.customer_label || ''),
    coverageMode: row.coverage_mode,
    status: row.status,
    priority: Number(row.priority || 0),
    pinCodes: pinsFromValue(row.pin_codes_json),
    polygon: row.polygon_geojson ? parseJson(row.polygon_geojson, null) : null,
    allowPinFallback: Number(row.allow_pin_fallback) === 1,
    unavailableMessage: String(row.unavailable_message || ''),
    internalNote: String(row.internal_note || ''),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizedZone(payload = {}, current = null) {
  const base = current || {};
  const coverageMode = clean(payload.coverageMode ?? base.coverageMode ?? 'pincode', 20).toLowerCase();
  const status = clean(payload.status ?? base.status ?? 'draft', 20).toLowerCase();
  if (!COVERAGE_MODES.has(coverageMode)) throw new ServiceabilityError('Invalid coverage mode.');
  if (!ZONE_STATUSES.has(status)) throw new ServiceabilityError('Invalid serviceability zone status.');
  const name = clean(payload.name ?? base.name, 100);
  if (!name) throw new ServiceabilityError('Enter a name for the delivery zone.');
  const rawPins = hasOwn(payload, 'pinCodes') ? payload.pinCodes : (base.pinCodes || []);
  const pinCodes = pinsFromValue(rawPins);
  const rawPolygon = hasOwn(payload, 'polygon') ? payload.polygon : (base.polygon || null);
  const needsPolygon = coverageMode !== 'pincode';
  const polygon = normalizePolygon(rawPolygon, { required: needsPolygon && status === 'active' });
  const allowPinFallback = coverageMode === 'hybrid' && Boolean(payload.allowPinFallback ?? base.allowPinFallback);
  const priorityRaw = payload.priority ?? base.priority ?? 0;
  const priority = Number(priorityRaw);
  if (!Number.isInteger(priority) || priority < -10000 || priority > 10000) {
    throw new ServiceabilityError('Priority must be a whole number between -10000 and 10000.');
  }
  if (status === 'active') {
    if (coverageMode === 'pincode' && !pinCodes.length) throw new ServiceabilityError('Add at least one PIN code before activating this zone.');
    if (coverageMode === 'hybrid' && allowPinFallback && !pinCodes.length) throw new ServiceabilityError('Add PIN codes or turn off PIN fallback before activating this hybrid zone.');
  }
  return {
    id: base.id || null,
    name,
    customerLabel: clean(payload.customerLabel ?? base.customerLabel, 100),
    coverageMode,
    status,
    priority,
    pinCodes,
    polygon,
    allowPinFallback,
    unavailableMessage: clean(payload.unavailableMessage ?? base.unavailableMessage, 240),
    internalNote: clean(payload.internalNote ?? base.internalNote, 1000)
  };
}

function effectivePins(zone) {
  if (zone.status !== 'active') return [];
  if (zone.coverageMode === 'pincode' || (zone.coverageMode === 'hybrid' && zone.allowPinFallback)) return zone.pinCodes;
  return [];
}
function checkPinConflicts(zone, others) {
  const owned = new Set(effectivePins(zone));
  if (!owned.size) return;
  for (const other of others) {
    if (String(other.id) === String(zone.id)) continue;
    for (const pin of effectivePins(other)) {
      if (owned.has(pin)) throw new ServiceabilityError(`PIN code ${pin} is already assigned to active zone "${other.name}". Active PIN ownership must be unique.`, 409, 'DUPLICATE_ACTIVE_PIN');
    }
  }
}
function sortMatches(a, b) {
  return Number(b.zone.priority) - Number(a.zone.priority) ||
    String(a.zone.id).localeCompare(String(b.zone.id));
}

function matchesZone(zone, destination) {
  const pinMatch = !!destination.pincode && zone.pinCodes.includes(destination.pincode);
  const hasCoordinates = Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude);
  if (zone.coverageMode === 'pincode') return pinMatch ? 'pincode' : '';
  if (zone.coverageMode === 'polygon') {
    if (!hasCoordinates || !zone.polygon) return '';
    return pointInServicePolygon(destination.latitude, destination.longitude, zone.polygon) ? 'polygon' : '';
  }
  if (hasCoordinates) {
    if (!zone.polygon) return '';
    // Coordinates are authoritative for hybrid zones: do not fall back by PIN
    // when a provided coordinate lies outside the polygon.
    return pointInServicePolygon(destination.latitude, destination.longitude, zone.polygon) ? 'polygon' : '';
  }
  return zone.allowPinFallback && pinMatch ? 'pincode_fallback' : '';
}

export function evaluateZones(zoneValues, destinationInput) {
  const destination = normalizeDestination(destinationInput);
  const zones = (Array.isArray(zoneValues) ? zoneValues : []).map(zone => {
    if (zone && zone.coverageMode) {
      // readZones already returns normalized domain objects. Preserve those
      // values here instead of running the owner-input normalizer a second time.
      return { ...zone, id: String(zone.id), pinCodes: pinsFromValue(zone.pinCodes || []) };
    }
    return rowToZone(zone);
  });
  const matches = [];
  for (const zone of zones) {
    if (!['active', 'paused'].includes(zone.status)) continue;
    const matchType = matchesZone(zone, destination);
    if (matchType) matches.push({ zone, matchType, serviceable: zone.status === 'active' });
  }
  const activeMatches = matches.filter(match => match.zone.status === 'active').sort(sortMatches);
  const pausedMatches = matches.filter(match => match.zone.status === 'paused').sort(sortMatches);
  const winner = activeMatches[0] || pausedMatches[0] || null;
  if (!winner) {
    return {
      serviceable: false, orderAllowed: false, code: 'OUTSIDE_SERVICE_AREA',
      message: DEFAULT_UNAVAILABLE_MESSAGE, zone: null, matchType: null,
      matches: matches.map(matchSummary)
    };
  }
  if (winner.zone.status === 'paused') {
    return {
      serviceable: false, orderAllowed: false, code: 'ZONE_PAUSED',
      message: winner.zone.unavailableMessage || 'Delivery is temporarily unavailable in this area.',
      zone: winner.zone, matchType: winner.matchType, matches: matches.map(matchSummary)
    };
  }
  return {
    serviceable: true, orderAllowed: true, code: 'SERVICEABLE',
    message: 'Delivery is available at this location.',
    zone: winner.zone, matchType: winner.matchType, matches: matches.map(matchSummary)
  };
}

function matchSummary(match) {
  return {
    zoneId: match.zone.id,
    zoneName: match.zone.name,
    customerLabel: match.zone.customerLabel,
    status: match.zone.status,
    priority: match.zone.priority,
    matchType: match.matchType,
    serviceable: match.serviceable
  };
}

async function readSettings(env) {
  try {
    const row = await env.DB.prepare('SELECT id,enforcement_mode,config_version,updated_at FROM serviceability_settings WHERE id=1').first();
    return {
      enforcementMode: MODES.has(row?.enforcement_mode) ? row.enforcement_mode : 'off',
      configVersion: Number.isInteger(Number(row?.config_version)) ? Number(row?.config_version) : 1,
      updatedAt: row?.updated_at || null
    };
  } catch (error) {
    console.error('FreshWay serviceability settings unavailable:', error?.message || error);
    throw new ServiceabilityError("We couldn't verify delivery availability. Please try again.", 503, 'SERVICEABILITY_UNAVAILABLE');
  }
}
async function readZones(env, all = false) {
  try {
    const sql = all
      ? 'SELECT * FROM delivery_zones ORDER BY priority DESC,id ASC'
      : "SELECT * FROM delivery_zones WHERE status IN ('active','paused') ORDER BY priority DESC,id ASC";
    const { results } = await env.DB.prepare(sql).all();
    return (results || []).map(rowToZone);
  } catch (error) {
    console.error('FreshWay serviceability zones unavailable:', error?.message || error);
    throw new ServiceabilityError("We couldn't verify delivery availability. Please try again.", 503, 'SERVICEABILITY_UNAVAILABLE');
  }
}

export async function checkServiceability(env, destinationInput) {
  const settings = await readSettings(env);
  // Preserve the legacy checkout contract while this feature is Off. Do not
  // validate optional GPS fields until Shadow/Enforced has been enabled.
  if (settings.enforcementMode === 'off') {
    return { mode: 'off', serviceable: null, orderAllowed: true, code: 'SERVICEABILITY_OFF', message: '', zone: null, matchType: null, configVersion: settings.configVersion };
  }
  const destination = normalizeDestination(destinationInput);
  const zones = await readZones(env);
  if (settings.enforcementMode === 'enforced' && !zones.some(zone => zone.status === 'active')) {
    return { mode: 'enforced', serviceable: false, orderAllowed: false, code: 'NO_ACTIVE_ZONES', message: "We couldn't verify delivery availability. Please contact FreshWay or try again later.", zone: null, matchType: null, configVersion: settings.configVersion };
  }
  const result = evaluateZones(zones, destination);
  return {
    ...result,
    mode: settings.enforcementMode,
    orderAllowed: settings.enforcementMode === 'shadow' ? true : result.orderAllowed,
    configVersion: settings.configVersion
  };
}

export async function getServiceabilityAdmin(env) {
  const [row, zones] = await Promise.all([
    env.DB.prepare('SELECT id,enforcement_mode,config_version,updated_at FROM serviceability_settings WHERE id=1').first(),
    env.DB.prepare('SELECT * FROM delivery_zones ORDER BY priority DESC,id ASC').all()
  ]);
  const settings = {
    enforcementMode: MODES.has(row?.enforcement_mode) ? row.enforcement_mode : 'off',
    configVersion: Number(row?.config_version || 1),
    updatedAt: row?.updated_at || null
  };
  const allZones = (zones.results || []).map(rowToZone);
  const activeZones = allZones.filter(zone => zone.status === 'active');
  return {
    settings,
    zones: allZones,
    summary: {
      active: activeZones.length,
      paused: allZones.filter(zone => zone.status === 'paused').length,
      draft: allZones.filter(zone => zone.status === 'draft').length,
      archived: allZones.filter(zone => zone.status === 'archived').length,
      valid: activeZones.length > 0 && activeZones.every(zone => {
        try { normalizedZone(zone, zone); return true; } catch (_) { return false; }
      })
    }
  };
}

async function writeAudit(env, { action, zoneId = null, enforcementMode = null, details = {} }) {
  return env.DB.prepare('INSERT INTO serviceability_audit (action,zone_id,enforcement_mode,details_json,actor) VALUES (?,?,?,?,?)')
    .bind(action, zoneId, enforcementMode, JSON.stringify(details), 'owner');
}
async function bumpConfigVersion(env) {
  return env.DB.prepare('UPDATE serviceability_settings SET config_version=config_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=1');
}
function storedZoneStatements(zone) {
  return [
    zone.id
  ];
}
function zoneSqlValues(zone) {
  return [
    zone.name, zone.customerLabel, zone.coverageMode, zone.status, zone.priority,
    JSON.stringify(zone.pinCodes), zone.polygon ? JSON.stringify(zone.polygon) : null,
    zone.allowPinFallback ? 1 : 0, zone.unavailableMessage, zone.internalNote
  ];
}
function zoneQueryFields() {
  return 'name=?,customer_label=?,coverage_mode=?,status=?,priority=?,pin_codes_json=?,polygon_geojson=?,allow_pin_fallback=?,unavailable_message=?,internal_note=?,updated_at=CURRENT_TIMESTAMP';
}
async function validateEffectiveConfig(env, zone, currentId = null) {
  const data = await getServiceabilityAdmin(env);
  const others = data.zones.filter(item => item.id !== currentId);
  checkPinConflicts(zone, others);
  if (data.settings.enforcementMode === 'enforced') {
    const active = others.filter(item => item.status === 'active');
    if (zone.status === 'active') active.push(zone);
    if (!active.length) throw new ServiceabilityError('Invalid serviceability configuration: keep at least one valid active zone while enforcement is enabled.', 409, 'ACTIVE_ZONE_REQUIRED');
  }
  return data;
}

export async function createServiceabilityZone(env, payload = {}) {
  const zone = normalizedZone(payload);
  zone.id = crypto.randomUUID();
  const data = await validateEffectiveConfig(env, zone);
  const audit = writeAudit(env, { action: 'zone_created', zoneId: zone.id, details: { name: zone.name, status: zone.status, coverageMode: zone.coverageMode } });
  const statement = env.DB.prepare('INSERT INTO delivery_zones (id,name,customer_label,coverage_mode,status,priority,pin_codes_json,polygon_geojson,allow_pin_fallback,unavailable_message,internal_note) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(zone.id, ...zoneSqlValues(zone));
  await env.DB.batch([statement, bumpConfigVersion(env), audit]);
  return await getServiceabilityAdmin(env);
}

export async function updateServiceabilityZone(env, id, payload = {}) {
  const zoneId = clean(id, 100);
  if (!zoneId) throw new ServiceabilityError('Invalid serviceability zone ID.');
  const currentRow = await env.DB.prepare('SELECT * FROM delivery_zones WHERE id=? LIMIT 1').bind(zoneId).first();
  if (!currentRow) throw new ServiceabilityError('Serviceability zone not found.', 404, 'ZONE_NOT_FOUND');
  const current = rowToZone(currentRow);
  const zone = normalizedZone(payload, current);
  zone.id = zoneId;
  await validateEffectiveConfig(env, zone, zoneId);
  const audit = writeAudit(env, { action: zone.status === 'archived' ? 'zone_archived' : 'zone_updated', zoneId, details: { name: zone.name, status: zone.status, coverageMode: zone.coverageMode } });
  const statement = env.DB.prepare(`UPDATE delivery_zones SET ${zoneQueryFields()} WHERE id=?`)
    .bind(...zoneSqlValues(zone), zoneId);
  await env.DB.batch([statement, bumpConfigVersion(env), audit]);
  return await getServiceabilityAdmin(env);
}

export async function updateServiceabilitySettings(env, payload = {}) {
  const mode = clean(payload.enforcementMode, 20).toLowerCase();
  if (!MODES.has(mode)) throw new ServiceabilityError('Invalid serviceability enforcement mode.');
  const data = await getServiceabilityAdmin(env);
  if (mode === 'enforced') {
    const active = data.zones.filter(zone => zone.status === 'active');
    if (!active.length) throw new ServiceabilityError('Invalid serviceability configuration: activate and test at least one delivery zone before enforcing checks.');
    const seen = new Map();
    for (const zone of active) {
      const candidate = normalizedZone(zone, zone);
      checkPinConflicts(candidate, [...active.filter(item => item.id !== zone.id)]);
      for (const pin of effectivePins(candidate)) seen.set(pin, zone.id);
    }
  }
  const nextVersion = data.settings.configVersion + 1;
  const audit = writeAudit(env, { action: 'enforcement_mode_changed', enforcementMode: mode, details: { previousMode: data.settings.enforcementMode, configVersion: nextVersion } });
  const setting = env.DB.prepare('UPDATE serviceability_settings SET enforcement_mode=?,config_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=1')
    .bind(mode, nextVersion);
  await env.DB.batch([setting, audit]);
  return await getServiceabilityAdmin(env);
}

export async function testServiceabilityDestination(env, payload = {}) {
  const destination = normalizeDestination(payload.address || payload);
  const data = await getServiceabilityAdmin(env);
  const result = evaluateZones(data.zones, destination);
  const warningCodes = new Set();
  const activePinOwners = new Map();
  for (const zone of data.zones) {
    if (zone.status !== 'active') continue;
    for (const pin of effectivePins(zone)) {
      if (activePinOwners.has(pin)) warningCodes.add('DUPLICATE_ACTIVE_PIN');
      else activePinOwners.set(pin, zone.id);
    }
  }
  const point = destination.latitude == null ? null : [destination.longitude, destination.latitude];
  const matchedZones = result.matches;
  return {
    settings: data.settings,
    destination: { pincode: destination.pincode, hasCoordinates: !!point },
    decision: {
      serviceable: result.serviceable,
      code: result.code,
      message: result.message,
      winnerZoneId: result.zone?.id || null,
      winnerZoneName: result.zone?.name || null,
      matchType: result.matchType
    },
    matches: matchedZones,
    warnings: [...warningCodes]
  };
}
