import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCatalogueRequest } from '../src/catalogue-api.js';

function fakeEnv(initialActive) {
  const stored = {
    id: 'cat-1',
    name: 'Cold-pressed oils',
    slug: 'cold-pressed-oils',
    icon: '🛒',
    image_data: null,
    image_mime_type: null,
    description: 'Original description',
    display_order: 10,
    active: initialActive
  };

  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          args: [],
          bind(...args) {
            this.args = args;
            return this;
          },
          async first() {
            if (sql.startsWith('SELECT * FROM categories WHERE id=?')) {
              return { ...stored };
            }
            if (sql.startsWith('SELECT id FROM categories WHERE slug=? AND id<>?')) {
              return null;
            }
            throw new Error('Unexpected first() query: ' + sql);
          },
          async run() {
            if (sql.startsWith('UPDATE categories SET name=?')) {
              const [name, slug, icon, imageData, imageMimeType, description, displayOrder, active] = this.args;
              Object.assign(stored, {
                name, slug, icon, image_data: imageData, image_mime_type: imageMimeType,
                description, display_order: displayOrder, active
              });
              return { meta: { changes: 1 } };
            }
            throw new Error('Unexpected run() query: ' + sql);
          }
        };
        return statement;
      }
    }
  };

  return { env, stored };
}

async function patchCategory(env, payload) {
  return handleCatalogueRequest(new Request('https://api.example.test/api/admin/categories/cat-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }), env);
}

test('partial category update preserves the hidden state', async () => {
  const { env, stored } = fakeEnv(0);
  const response = await patchCategory(env, { description: 'Updated description' });
  assert.equal(response.status, 200);
  assert.equal(stored.description, 'Updated description');
  assert.equal(stored.active, 0);
});

test('partial category update preserves the active state', async () => {
  const { env, stored } = fakeEnv(1);
  const response = await patchCategory(env, { description: 'Updated description' });
  assert.equal(response.status, 200);
  assert.equal(stored.active, 1);
});

test('category status changes still honor explicit true and false values', async () => {
  const hidden = fakeEnv(0);
  let response = await patchCategory(hidden.env, { active: true });
  assert.equal(response.status, 200);
  assert.equal(hidden.stored.active, 1);

  const active = fakeEnv(1);
  response = await patchCategory(active.env, { active: false });
  assert.equal(response.status, 200);
  assert.equal(active.stored.active, 0);
});


function imageEnv(row) {
  let lastSql = '';
  const env = {
    DB: {
      prepare(sql) {
        lastSql = sql;
        return {
          args: [],
          bind(...args) { this.args = args; return this; },
          async first() { return row; },
          async all() { return { results: [row] }; }
        };
      }
    }
  };
  return { env, get lastSql() { return lastSql; } };
}

test('public custom catalogue images are served as cacheable binary responses with ETags', async () => {
  const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  const stored = { image_data: Buffer.from(bytes).toString('base64'), image_mime_type: 'image/webp' };
  const fixture = imageEnv(stored);
  const url = 'https://api.example.test/api/catalogue/images/products/p-1?v=v1';
  const response = await handleCatalogueRequest(new Request(url), fixture.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.match(response.headers.get('cache-control') || '', /public, max-age=31536000, immutable/);
  assert.match(response.headers.get('etag') || '', /^"[a-f0-9]{64}"$/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(bytes));
  const etag = response.headers.get('etag');
  const notModified = await handleCatalogueRequest(new Request(url, { headers: { 'if-none-match': etag } }), fixture.env);
  assert.equal(notModified.status, 304, 'matching ETag should avoid retransmitting image bytes');
  assert.equal(notModified.headers.get('etag'), etag);
});

test('public image endpoint does not expose hidden or missing catalogue images', async () => {
  const fixture = imageEnv(null);
  const response = await handleCatalogueRequest(new Request('https://api.example.test/api/catalogue/images/products/hidden?v=v1'), fixture.env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('public product catalogue returns image URLs without embedding Base64 image payloads', async () => {
  const row = {
    id: 'p-1', name: 'Test oil', unit: 'litre', price: 500, emoji: '🫙', active: 1,
    category_id: 'cat-1', display_order: 1, has_custom_image: 1, image_length: 36,
    image_data: 'aGVsbG8gd29ybGQ=', updated_at: '2026-10-29 12:00:00',
    stock_managed: 0, stock_quantity: 0, low_stock_threshold: 5,
    category_name: 'Oils', category_slug: 'oils'
  };
  const fixture = imageEnv(row);
  const response = await handleCatalogueRequest(new Request('https://api.example.test/api/products'), fixture.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.products[0].image_url, /^\/api\/catalogue\/images\/products\/p-1\?v=[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(body.products[0], 'image_data'), false);
  assert.equal(Object.hasOwn(body.products[0], 'image_mime_type'), false);
  assert.doesNotMatch(fixture.lastSql, /p\.image_data\s*,\s*p\.image_mime_type/);
});

test('public category catalogue returns image URLs and avoids grouping on Base64 values', async () => {
  const row = {
    id: 'cat-1', name: 'Oils', slug: 'oils', icon: '🫙', description: '',
    display_order: 1, updated_at: '2026-10-29 12:00:00', has_custom_image: 1,
    image_length: 40, image_data: 'aGVsbG8gd29ybGQ=', product_count: 2
  };
  const fixture = imageEnv(row);
  const response = await handleCatalogueRequest(new Request('https://api.example.test/api/categories'), fixture.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.categories[0].image_url, /^\/api\/catalogue\/images\/categories\/cat-1\?v=[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(body.categories[0], 'image_data'), false);
  assert.equal(Object.hasOwn(body.categories[0], 'image_mime_type'), false);
  assert.doesNotMatch(fixture.lastSql, /GROUP BY[^;]*c\.image_data/i);
});


test('public image endpoint accepts valid unpadded Base64 data', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const { env } = imageEnv({ image_data: Buffer.from(bytes).toString('base64').replace(/=+$/, ''), image_mime_type: 'image/png' });
  const response = await handleCatalogueRequest(new Request('https://api.example.test/api/catalogue/images/products/p-1?v=v1'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(bytes));
});

test('malformed Base64 image returns 404 instead of an API exception response', async () => {
  const { env } = imageEnv({ image_data: 'not-valid-base64!', image_mime_type: 'image/png' });
  const response = await handleCatalogueRequest(new Request('https://api.example.test/api/catalogue/images/products/p-1?v=v1'), env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});


test('immutable image URL version changes when image content changes but its outer metadata matches', async () => {
  const makeRow = image_data => ({
    id: 'p-version', name: 'Test oil', unit: 'litre', price: 500, emoji: '🫙', active: 1,
    category_id: 'cat-1', display_order: 1, has_custom_image: 1, image_length: image_data.length,
    image_data, updated_at: '2026-10-29 12:00:00', stock_managed: 0,
    stock_quantity: 0, low_stock_threshold: 5, category_name: 'Oils', category_slug: 'oils'
  });
  const before = imageEnv(makeRow('AAAA-middle-BBBB'));
  const after = imageEnv(makeRow('AAAA-middlx-BBBB'));
  const beforeResponse = await handleCatalogueRequest(new Request('https://api.example.test/api/products'), before.env);
  const afterResponse = await handleCatalogueRequest(new Request('https://api.example.test/api/products'), after.env);
  const beforeUrl = (await beforeResponse.json()).products[0].image_url;
  const afterUrl = (await afterResponse.json()).products[0].image_url;
  assert.notEqual(beforeUrl, afterUrl, 'different image bytes must never share an immutable URL version');
  assert.match(beforeUrl, /\\?v=[a-f0-9]{64}$/);
  assert.ok(beforeUrl.length < 150, 'immutable image URL should remain compact, not embed Base64 data');
  assert.equal(makeRow('AAAA-middle-BBBB').image_length, makeRow('AAAA-middlx-BBBB').image_length);
});
