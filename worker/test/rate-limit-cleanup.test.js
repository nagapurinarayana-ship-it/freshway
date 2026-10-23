import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupExpiredRateLimits } from '../src/rate-limit-cleanup.js';

test('cleans only rate-limit windows older than 24 hours', async () => {
  let query = '';
  let params = [];
  const env = {
    DB: {
      prepare(sql) {
        query = sql;
        return {
          bind(...values) {
            params = values;
            return this;
          },
          async run() {
            return { meta: { changes: 49 } };
          }
        };
      }
    }
  };
  const nowMs = Date.parse('2026-10-23T12:00:00.000Z');
  const expectedCutoff = Math.floor(nowMs / 1000) - 24 * 60 * 60;

  const result = await cleanupExpiredRateLimits(env, nowMs);

  assert.equal(query, 'DELETE FROM auth_rate_limits WHERE window_start < ?');
  assert.deepEqual(params, [expectedCutoff]);
  assert.deepEqual(result, { cutoff: expectedCutoff, deleted: 49 });
});

test('reports zero deletions when no expired rate-limit windows exist', async () => {
  const env = {
    DB: {
      prepare(sql) {
        assert.equal(sql, 'DELETE FROM auth_rate_limits WHERE window_start < ?');
        return {
          bind(cutoff) {
            assert.ok(Number.isInteger(cutoff));
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          }
        };
      }
    }
  };

  const result = await cleanupExpiredRateLimits(env, Date.parse('2026-10-23T12:00:00.000Z'));
  assert.equal(result.deleted, 0);
});

test('rejects an invalid clock value before issuing a database query', async () => {
  const env = {
    DB: {
      prepare() {
        assert.fail('Invalid time must not issue a database query.');
      }
    }
  };
  await assert.rejects(() => cleanupExpiredRateLimits(env, Number.NaN), /finite timestamp/);
});
