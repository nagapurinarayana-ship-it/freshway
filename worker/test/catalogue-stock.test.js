import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createProduct, updateProduct, deleteProduct as deleteCatalogueProduct } from '../src/catalogue-api.js';
import { deleteProduct as deleteAdminProduct } from '../src/admin-products.js';
import { addProduct as addLegacyProduct, updateProduct as updateLegacyProduct } from '../src/index.js';

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
      CREATE TABLE delivery_store_inventory (
        store_id TEXT NOT NULL REFERENCES delivery_stores(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (store_id,product_id)
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT
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


test('catalogue product deletion removes only unreserved store inventory atomically', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    db.seedStore('store-paused', 0);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 8 }));
    const productId = created.product.id;
    assert.equal(db.inventory(productId).length, 2);

    const result = await deleteCatalogueProduct({ DB: db }, productId);

    assert.deepEqual(result, { ok: true });
    assert.equal(db.product(productId), undefined);
    assert.deepEqual(db.inventory(productId), []);
  } finally { db.close(); }
});

test('legacy Owner product deletion also removes unreserved store inventory atomically', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 4 }));
    const productId = created.product.id;

    const result = await deleteAdminProduct({ DB: db }, productId);

    assert.deepEqual(result, { ok: true });
    assert.equal(db.product(productId), undefined);
    assert.deepEqual(db.inventory(productId), []);
  } finally { db.close(); }
});

test('product deletion is refused when a delivery reservation still references the product', async () => {
  const db = new SQLiteD1();
  try {
    db.seedStore('store-active', 1);
    const created = await createProduct({ DB: db }, newProduct({ stockQuantity: 6 }));
    const productId = created.product.id;
    db.db.prepare('INSERT INTO delivery_store_inventory_reservations (id,product_id) VALUES (?,?)')
      .run('reservation-1', productId);

    await assert.rejects(
      () => deleteCatalogueProduct({ DB: db }, productId),
      /delivery reservation history/i
    );
    assert.ok(db.product(productId), 'the product must remain when reservation history references it');
    assert.equal(db.inventory(productId).length, 1, 'inventory must remain unchanged on a refused deletion');
  } finally { db.close(); }
});

test('product deletion is refused when an order item references the product', async () => {
  const db = new SQLiteD1();
  try {
    const created = await createProduct({ DB: db }, newProduct({ stockManaged: false, stockQuantity: 0 }));
    const productId = created.product.id;
    db.db.prepare('INSERT INTO order_items (product_id) VALUES (?)').run(productId);

    await assert.rejects(
      () => deleteAdminProduct({ DB: db }, productId),
      /part of existing orders/i
    );
    assert.ok(db.product(productId));
  } finally { db.close(); }
});
