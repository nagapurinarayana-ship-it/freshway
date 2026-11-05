import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createProduct, updateProduct, handleCatalogueRequest } from '../src/catalogue-api.js';
import { addProduct as addLegacyProduct, updateProduct as updateLegacyProduct } from '../src/index.js';
import { deleteProduct as deleteLegacyProduct } from '../src/admin-products.js';

class SQLiteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL,
        emoji TEXT NOT NULL DEFAULT '🛒', image_data TEXT, image_mime_type TEXT,
        active INTEGER NOT NULL DEFAULT 1, category_id TEXT REFERENCES categories(id),
        display_order INTEGER NOT NULL DEFAULT 999, stock_managed INTEGER NOT NULL DEFAULT 0,
        stock_quantity INTEGER NOT NULL DEFAULT 0, low_stock_threshold INTEGER NOT NULL DEFAULT 5,
        hsn_code TEXT NOT NULL DEFAULT '', gst_rate_bps INTEGER NOT NULL DEFAULT 0,
        gst_rate_confirmed INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE delivery_stores (
        id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE delivery_store_catalogue (
        store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        is_available INTEGER NOT NULL DEFAULT 1,
        price_override INTEGER,
        PRIMARY KEY (store_id,product_id)
      );
      CREATE TABLE delivery_store_inventory (
        store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (store_id,product_id)
      );
      -- Production order_items intentionally keeps the product id as a snapshot
      -- value (rather than an FK), so deletion safety must check it in the API.
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL
      );
      CREATE TABLE delivery_store_inventory_reservations (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT
      );
      INSERT INTO categories (id,name,active) VALUES ('cat-1','Pantry',1);
    `);
  }
  prepare(sql) {
    const owner = this;
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      executeSync() {
        const result = owner.db.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } };
      },
      async run() { return statement.executeSync(); },
      async first() { return owner.db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: owner.db.prepare(sql).all(...args) }; }
    };
    return statement;
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.executeSync());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.db.close(); }
  seedStore(id, isActive = 1) {
    this.db.prepare('INSERT INTO delivery_stores (id,is_active) VALUES (?,?)').run(id,isActive);
  }
  product(id) { return this.db.prepare('SELECT * FROM products WHERE id=?').get(id); }
  inventory(productId) {
    return this.db.prepare('SELECT store_id,stock_quantity FROM delivery_store_inventory WHERE product_id=? ORDER BY store_id').all(productId).map(row => ({...row}));
  }
}

const newProduct = (overrides = {}) => ({
  name: 'HMT Rice', unit: 'kg', price: 65, categoryId: 'cat-1',
  stockManaged: true, stockQuantity: 12, lowStockThreshold: 2, ...overrides
});

test('new tracked product assigns initial stock to the only active store and seeds other stores at zero', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active',1);
    db.seedStore('store-paused',0);
    const result = await createProduct({DB:db},newProduct());
    const productId = result.product.id;
    assert.equal(result.product.stock_quantity,12);
    assert.equal(result.stockAllocationRequired,false);
    assert.deepEqual(db.inventory(productId),[
      {store_id:'store-active',stock_quantity:12},
      {store_id:'store-paused',stock_quantity:0}
    ]);
    assert.equal(db.product(productId).stock_quantity,12);
    assert.deepEqual(db.db.prepare('SELECT store_id,is_available,price_override FROM delivery_store_catalogue WHERE product_id=? ORDER BY store_id').all(productId).map(row=>({...row})),[
      {store_id:'store-active',is_available:1,price_override:null},
      {store_id:'store-paused',is_available:1,price_override:null}
    ]);
  } finally { db.close(); }
});

test('new tracked product with multiple active stores starts at zero and explicitly requires allocation', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-a',1);
    db.seedStore('store-b',1);
    const result = await createProduct({DB:db},newProduct());
    const productId = result.product.id;
    assert.equal(result.stockAllocationRequired,true);
    assert.equal(result.product.stock_quantity,0);
    assert.deepEqual(db.inventory(productId),[
      {store_id:'store-a',stock_quantity:0},
      {store_id:'store-b',stock_quantity:0}
    ]);
  } finally { db.close(); }
});

test('editing a tracked product cannot overwrite the store inventory aggregate with stale catalogue quantity', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-a',1);
    const created = await createProduct({DB:db},newProduct({stockQuantity:15}));
    const before = db.inventory(created.product.id);
    const result = await updateProduct({DB:db},created.product.id,{
      name:'HMT Rice premium',unit:'kg',price:70,categoryId:'cat-1',active:true,
      stockManaged:true,stockQuantity:0,lowStockThreshold:3
    });
    assert.equal(result.stock_quantity,15);
    assert.equal(db.product(created.product.id).stock_quantity,15);
    assert.deepEqual(db.inventory(created.product.id),before);
    assert.equal(db.product(created.product.id).name,'HMT Rice premium');
  } finally { db.close(); }
});

test('enabling tracking with one active store seeds that store in the same batch as the product update', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-a',1);
    const created = await createProduct({DB:db},newProduct({stockManaged:false,stockQuantity:0}));
    const result = await updateProduct({DB:db},created.product.id,{
      name:'HMT Rice',unit:'kg',price:65,categoryId:'cat-1',active:true,
      stockManaged:true,stockQuantity:7,lowStockThreshold:2
    });
    assert.equal(result.stock_quantity,7);
    assert.equal(db.product(created.product.id).stock_managed,1);
    assert.deepEqual(db.inventory(created.product.id),[{store_id:'store-a',stock_quantity:7}]);
  } finally { db.close(); }
});

test('enabling tracking with multiple active stores does not create phantom global stock', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-a',1);
    db.seedStore('store-b',1);
    const created = await createProduct({DB:db},newProduct({stockManaged:false,stockQuantity:12}));
    const result = await updateProduct({DB:db},created.product.id,{
      name:'HMT Rice',unit:'kg',price:65,categoryId:'cat-1',active:true,
      stockManaged:true,stockQuantity:12,lowStockThreshold:2
    });
    assert.equal(result.stockAllocationRequired,true);
    assert.equal(result.stock_quantity,0);
    assert.deepEqual(db.inventory(created.product.id),[
      {store_id:'store-a',stock_quantity:0},
      {store_id:'store-b',stock_quantity:0}
    ]);
  } finally { db.close(); }
});

test('legacy product endpoint also seeds store inventory and keeps tracked stock aggregate authoritative', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-a',1);
    db.seedStore('store-b',1);
    const created = await addLegacyProduct({DB:db},{
      id:'legacy-product',name:'Sunflower Oil',unit:'litre',price:150,stockManaged:true,stockQuantity:20
    });
    assert.equal(created.stock_quantity,0);
    assert.equal(created.stockAllocationRequired,true);
    assert.deepEqual(db.inventory('legacy-product'),[
      {store_id:'store-a',stock_quantity:0},
      {store_id:'store-b',stock_quantity:0}
    ]);

    // Give one store its authoritative on-hand quantity, then prove a stale
    // catalogue form value cannot overwrite the aggregate with zero.
    await db.prepare("UPDATE delivery_store_inventory SET stock_quantity=9 WHERE store_id='store-a' AND product_id='legacy-product'").run();
    await db.prepare("UPDATE products SET stock_quantity=9 WHERE id='legacy-product'").run();
    const result = await updateLegacyProduct({DB:db},'legacy-product',{
      name:'Sunflower Oil',price:155,stockManaged:true,stockQuantity:0
    });
    assert.equal(result.stockQuantity,9);
    assert.equal(db.product('legacy-product').stock_quantity,9);
    assert.equal(db.inventory('legacy-product').find(row=>row.store_id==='store-a').stock_quantity,9);
  } finally { db.close(); }
});


async function deleteProductThroughOwnerRoute(db, productId) {
  const response = await handleCatalogueRequest(
    new Request('https://freshway.test/api/admin/catalogue/products/' + encodeURIComponent(productId), {
      method: 'DELETE'
    }),
    { DB: db }
  );
  return { response, body: await response.json() };
}

test('Owner catalogue deletion removes zero-stock store allocations and cascades store catalogue rows atomically', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    db.seedStore('store-paused', 0);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 0 }));
    const productId = created.product.id;
    assert.equal(db.inventory(productId).length, 2);
    assert.equal(Number(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_catalogue WHERE product_id=?').get(productId).count), 2);
    assert.ok(db.inventory(productId).every(row => row.stock_quantity === 0));

    const { response, body } = await deleteProductThroughOwnerRoute(db, productId);

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(db.product(productId), undefined);
    assert.deepEqual(db.inventory(productId), []);
    assert.equal(Number(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_catalogue WHERE product_id=?').get(productId).count), 0);
  } finally { db.close(); }
});

test('Owner catalogue deletion refuses a product with on-hand stock and preserves every store allocation', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    db.seedStore('store-paused', 0);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 8 }));
    const productId = created.product.id;
    const beforeInventory = db.inventory(productId);
    const beforeCatalogue = db.db.prepare('SELECT store_id,is_available,price_override FROM delivery_store_catalogue WHERE product_id=? ORDER BY store_id').all(productId).map(row => ({ ...row }));

    const { response, body } = await deleteProductThroughOwnerRoute(db, productId);

    assert.equal(response.status, 400);
    assert.match(body.error, /still has stock/i);
    assert.ok(db.product(productId));
    assert.deepEqual(db.inventory(productId), beforeInventory);
    assert.deepEqual(db.db.prepare('SELECT store_id,is_available,price_override FROM delivery_store_catalogue WHERE product_id=? ORDER BY store_id').all(productId).map(row => ({ ...row })), beforeCatalogue);
  } finally { db.close(); }
});

test('Owner catalogue deletion refuses products referenced by historical order items without changing store data', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 0 }));
    const productId = created.product.id;
    const beforeInventory = db.inventory(productId);
    db.db.prepare('INSERT INTO order_items (product_id) VALUES (?)').run(productId);

    const { response, body } = await deleteProductThroughOwnerRoute(db, productId);

    assert.equal(response.status, 400);
    assert.match(body.error, /part of existing orders/i);
    assert.ok(db.product(productId));
    assert.deepEqual(db.inventory(productId), beforeInventory);
    assert.equal(Number(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_catalogue WHERE product_id=?').get(productId).count), 1);
  } finally { db.close(); }
});

test('Owner catalogue deletion refuses products with any reservation history and preserves store data', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 0 }));
    const productId = created.product.id;
    const beforeInventory = db.inventory(productId);
    db.db.prepare('INSERT INTO delivery_store_inventory_reservations (id,product_id) VALUES (?,?)').run('released-reservation', productId);

    const { response, body } = await deleteProductThroughOwnerRoute(db, productId);

    assert.equal(response.status, 400);
    assert.match(body.error, /delivery reservation history/i);
    assert.ok(db.product(productId));
    assert.deepEqual(db.inventory(productId), beforeInventory);
    assert.equal(Number(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_catalogue WHERE product_id=?').get(productId).count), 1);
  } finally { db.close(); }
});

test('Owner catalogue deletion returns a clear not-found result for a missing product', async () => {
  const db = new SQLiteD1();
  try {
    const { response, body } = await deleteProductThroughOwnerRoute(db, 'missing-product');
    assert.equal(response.status, 400);
    assert.equal(body.error, 'Product not found.');
  } finally { db.close(); }
});


test('legacy Owner product endpoint shares safe zero-stock deletion policy', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    db.seedStore('store-paused', 0);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 0 }));
    const productId = created.product.id;
    assert.equal(db.inventory(productId).length, 2);
    assert.ok(db.inventory(productId).every(row => row.stock_quantity === 0));

    const result = await deleteLegacyProduct({ DB: db }, productId);

    assert.deepEqual(result, { ok: true });
    assert.equal(db.product(productId), undefined);
    assert.deepEqual(db.inventory(productId), []);
    assert.equal(Number(db.db.prepare('SELECT COUNT(*) count FROM delivery_store_catalogue WHERE product_id=?').get(productId).count), 0);
  } finally { db.close(); }
});

test('legacy Owner product endpoint refuses positive stock and historical order or reservation history', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    const stocked = await createProduct({ DB: db }, newProduct({ stockQuantity: 5 }));
    await assert.rejects(
      () => deleteLegacyProduct({ DB: db }, stocked.product.id),
      /still has stock/i
    );
    assert.ok(db.product(stocked.product.id));
    assert.deepEqual(db.inventory(stocked.product.id), [{ store_id: 'store-active', stock_quantity: 5 }]);

    const ordered = await createProduct({ DB: db }, newProduct({ stockQuantity: 0 }));
    db.db.prepare('INSERT INTO order_items (product_id) VALUES (?)').run(ordered.product.id);
    await assert.rejects(
      () => deleteLegacyProduct({ DB: db }, ordered.product.id),
      /part of existing orders/i
    );
    assert.ok(db.product(ordered.product.id));

    const reserved = await createProduct({ DB: db }, newProduct({ stockQuantity: 0 }));
    db.db.prepare('INSERT INTO delivery_store_inventory_reservations (id,product_id) VALUES (?,?)').run('legacy-released-reservation', reserved.product.id);
    await assert.rejects(
      () => deleteLegacyProduct({ DB: db }, reserved.product.id),
      /delivery reservation history/i
    );
    assert.ok(db.product(reserved.product.id));
  } finally { db.close(); }
});
