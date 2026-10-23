import test from 'node:test';
import assert from 'node:assert/strict';
import { reports, summary } from '../src/admin-reports.js';

test('average order value uses the same eligibility rules as sales', async () => {
  const sql=[];
  const responses=[
    {count:4,eligible_count:2,sales:300,delivered_sales:100,cancelled_value:50,customers:3},
    {count:1,amount:20},
    {count:1,amount:100},
    {count:1},
    {count:1},
    {count:1},
    {count:1,orders:2},
    {},
    {}
  ];
  const DB={
    prepare(statement){const q={statement,bind(){return this}};sql.push(statement);return q},
    async batch(statements){return statements.map((_,i)=>({results:[responses[i]||{}]}))}
  };
  const result=await reports({DB},new URL('https://freshway.test/api/admin/reports?range=today'));
  assert.equal(result.sales,300);
  assert.equal(result.orders,2);
  assert.equal(result.totalOrders,4);
  assert.equal(result.eligibleOrders,2);
  assert.equal(result.aov,150);
  assert.match(sql[0],/SUM\(CASE WHEN o\.delivery_status!='Cancelled' AND o\.payment_status!='Cancelled' THEN 1 ELSE 0 END\) eligible_count/);
  assert.match(sql[0],/COUNT\(DISTINCT CASE WHEN c\.deleted_at IS NULL THEN o\.customer_id END\) customers/);
  assert.match(sql[5],/JOIN customers c ON c\.id=o\.customer_id AND c\.deleted_at IS NULL/);
  assert.match(sql[6],/JOIN customers c ON c\.id=o\.customer_id AND c\.deleted_at IS NULL/);
  assert.match(sql[8],/JOIN customers c ON c\.id=o\.customer_id AND c\.deleted_at IS NULL/);
});


test('summary excludes erased customer tombstones from the active customer count', async () => {
  const sql = [];
  const DB = {
    prepare(statement) { sql.push(statement); return { bind() { return this; } }; },
    async batch(statements) { return statements.map(() => ({ results: [{ count: 0, amount: 0 }] })); }
  };
  await summary({ DB });
  assert.match(sql[6], /c\.deleted_at IS NULL/);
});
