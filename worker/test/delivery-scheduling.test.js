import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, parseTimeMinutes, formatTimeMinutes } from '../src/delivery-scheduling.js';

test('time windows parse strict 24-hour times and reject malformed values', () => {
  assert.equal(parseTimeMinutes('00:00'), 0);
  assert.equal(parseTimeMinutes('09:30'), 570);
  assert.equal(parseTimeMinutes('23:59'), 1439);
  assert.equal(parseTimeMinutes('24:00'), null);
  assert.equal(parseTimeMinutes('9:30'), null);
  assert.equal(parseTimeMinutes('12:60'), null);
  assert.equal(formatTimeMinutes(600), '10:00');
  assert.equal(formatTimeMinutes(1440), '24:00');
});

test('store distance uses a bounded Haversine distance and rejects invalid coordinates', () => {
  assert.equal(distanceKm(0, 0, 0, 0), 0);
  const hyderabadToSecunderabad = distanceKm(17.385, 78.4867, 17.4399, 78.4983);
  assert.ok(hyderabadToSecunderabad > 5 && hyderabadToSecunderabad < 7);
  assert.equal(distanceKm(91, 0, 0, 0), null);
  assert.equal(distanceKm(0, 181, 0, 0), null);
});
