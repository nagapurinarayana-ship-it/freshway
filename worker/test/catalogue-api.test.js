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
