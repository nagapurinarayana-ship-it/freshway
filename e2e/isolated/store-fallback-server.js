import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCustomerDeliveryRequest } from '../../worker/src/delivery-scheduling.js';

class SQLiteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
    this.db.exec(`
      INSERT INTO categories (id,name,slug) VALUES ('category-test','Test category','test-category');
      INSERT INTO products (id,name,unit,price,category_id,stock_managed,stock_quantity)
        VALUES ('rice-test','Test Rice','kg',100,'category-test',1,8),
               ('oil-test','Test Oil','litre',150,'category-test',1,5),
               ('inactive-only-test','Inactive-only product','each',25,'category-test',1,5);
      INSERT INTO delivery_stores (id,name,address,latitude,longitude,service_radius_km,is_active)
        VALUES ('store-nearest','Nearest Store','Test Address A',17.385,78.4867,5,1),
               ('store-next','Next Nearest Store','Test Address B',17.395,78.4867,5,1),
               ('store-inactive','Inactive Store','Test Address C',17.3855,78.4867,5,0);
      INSERT INTO delivery_store_catalogue (store_id,product_id,is_available,price_override)
        SELECT s.id,p.id,1,NULL FROM delivery_stores s CROSS JOIN products p;
      INSERT INTO delivery_store_inventory (store_id,product_id,stock_quantity)
        VALUES ('store-nearest','rice-test',0),
               ('store-nearest','oil-test',5),
               ('store-next','rice-test',8),
               ('store-next','oil-test',0),
               ('store-nearest','inactive-only-test',0),
               ('store-next','inactive-only-test',0),
               ('store-inactive','rice-test',8),
               ('store-inactive','oil-test',5),
               ('store-inactive','inactive-only-test',5);
    `);
  }
  prepare(sql) {
    const owner = this;
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() { return owner.db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: owner.db.prepare(sql).all(...args) }; },
      async run() {
        const result = owner.db.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } };
      }
    };
    return statement;
  }
  close() { this.db.close(); }
}

const db = new SQLiteD1();
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request('http://127.0.0.1:4178' + incoming.url, {
    method: incoming.method,
    headers: incoming.headers,
    ...(body.length ? { body: body.toString('utf8') } : {})
  });
  if (incoming.method === 'GET' && incoming.url === '/health') {
    outgoing.writeHead(200, { 'content-type': 'text/plain' });
    outgoing.end('ok');
    return;
  }
  try {
    const response = await handleCustomerDeliveryRequest(request, { DB: db }, '');
    if (!response) {
      outgoing.writeHead(404, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: error?.message || 'Test server error' }));
  }
});
server.listen(4178, '127.0.0.1');
const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
