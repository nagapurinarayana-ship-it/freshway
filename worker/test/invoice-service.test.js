import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInvoiceSettings, updateInvoiceSettings, buildItemTax, prepareInvoiceIssue } from '../src/invoice-service.js';

function fakeEnv(initial=null){
  let row=initial;
  const db={
    prepare(sql){
      let params=[];
      return {
        bind(...values){params=values;return this},
        async first(){return row},
        async run(){
          if(sql.startsWith('INSERT INTO invoice_settings')){
            const [enabled,document_type,legal_name,business_address,state_name,state_code,gstin,series_prefix,footer,prices_include_tax]=params;
            row={id:1,enabled,document_type,legal_name,business_address,state_name,state_code,gstin,series_prefix,footer,prices_include_tax,updated_at:'2026-10-22T00:00:00.000Z'};
            return {meta:{changes:1}};
          }
          throw new Error('Unexpected SQL in invoice settings test: '+sql);
        }
      };
    }
  };
  return {DB:db};
}

test('invoice issuance defaults to disabled',async()=>{
  const settings=await getInvoiceSettings(fakeEnv());
  assert.equal(settings.enabled,false);
  assert.equal(settings.documentType,'commercial_invoice');
  assert.equal(settings.seriesPrefix,'FW');
});

test('allows a configured non-GST commercial invoice without a GST state code',async()=>{
  const env=fakeEnv();
  const settings=await updateInvoiceSettings(env,{
    enabled:true,documentType:'commercial_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road, Hyderabad',seriesPrefix:'FW',
    gstin:'',pricesIncludeTax:true
  });
  assert.equal(settings.enabled,true);
  assert.equal(settings.documentType,'commercial_invoice');
  assert.equal(settings.stateCode,'');
  assert.equal(settings.gstin,'');
});

test('does not enable a GST tax invoice with incomplete registration details',async()=>{
  const env=fakeEnv();
  await assert.rejects(()=>updateInvoiceSettings(env,{
    enabled:true,documentType:'gst_tax_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road',stateName:'Telangana',stateCode:'36',
    gstin:'',seriesPrefix:'FW',pricesIncludeTax:true
  }),/valid 15-character GSTIN/);
});

test('does not allow tax-exclusive checkout pricing in V1 invoice mode',async()=>{
  const env=fakeEnv();
  await assert.rejects(()=>updateInvoiceSettings(env,{
    enabled:true,documentType:'commercial_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road',seriesPrefix:'FW',pricesIncludeTax:false
  }),/tax-inclusive/);
});

test('requires seller GST state code to agree with GSTIN',async()=>{
  const env=fakeEnv();
  await assert.rejects(()=>updateInvoiceSettings(env,{
    enabled:true,documentType:'gst_tax_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road',stateName:'Telangana',stateCode:'27',
    gstin:'36ABCDE1234F1Z5',seriesPrefix:'FW',pricesIncludeTax:true
  }),/state code must match/);
});

test('extracts inclusive GST and splits intra-state tax without changing gross total',()=>{
  const line=buildItemTax({product_id:'oil',name:'Oil',unit:'litre',qty:1,price:105,line_total:105,hsn_code:'151790',gst_rate_bps:500},{
    documentType:'gst_tax_invoice'
  },'36','36');
  assert.equal(line.grossPaise,10500);
  assert.equal(line.taxablePaise,10000);
  assert.equal(line.cgstPaise,250);
  assert.equal(line.sgstPaise,250);
  assert.equal(line.igstPaise,0);
  assert.equal(line.taxablePaise+line.cgstPaise+line.sgstPaise+line.igstPaise,line.grossPaise);
});

test('uses IGST for inter-state supply and never duplicates split tax',()=>{
  const line=buildItemTax({product_id:'oil',name:'Oil',unit:'litre',qty:1,price:105,line_total:105,hsn_code:'151790',gst_rate_bps:500},{
    documentType:'gst_tax_invoice'
  },'36','27');
  assert.equal(line.grossPaise,10500);
  assert.equal(line.taxablePaise,10000);
  assert.equal(line.cgstPaise,0);
  assert.equal(line.sgstPaise,0);
  assert.equal(line.igstPaise,500);
  assert.equal(line.taxablePaise+line.igstPaise,line.grossPaise);
});


test('prepareInvoiceIssue binds every invoice insert parameter', async () => {
  const prepared=[];
  const env={DB:{
    prepare(sql){
      const statement={
        sql,params:[],
        bind(...values){this.params=values;return this;},
        async first(){
          if(sql.startsWith('SELECT id,invoice_number,document_type FROM invoices'))return null;
          if(sql.startsWith('SELECT o.id,o.customer_id'))return {
            id:'FW-12345678-ABC',customer_id:'customer-1',customer_name:'Test Customer',
            customer_phone:'919999999999',total:100,delivery_status:'Ready',is_test_order:0,
            created_at:'2026-10-22T06:00:00.000Z',registered_name:'Test Customer',
            registered_phone:'919999999999',recipient_name:'Test Customer',delivery_phone:'919999999999',
            house:'1 Main Road',building:'',floor:'',street:'Main Road',area:'Boduppal',
            locality:'',city:'Hyderabad',district:'Medchal',state:'Telangana',pincode:'500092',
            landmark:'',note:''
          };
          if(sql.startsWith('SELECT enabled,document_type'))return {
            enabled:1,document_type:'commercial_invoice',legal_name:'FreshWay Foods',
            business_address:'Shop 1, Main Road, Hyderabad',state_name:'',state_code:'',
            gstin:'',series_prefix:'FW',footer:'',prices_include_tax:1,updated_at:'2026-10-22'
          };
          if(sql.startsWith('SELECT store_name,about,phone'))return {
            store_name:'FreshWay',about:'',phone:'',whatsapp:'',email:'',
            address:'',shop_latitude:null,shop_longitude:null,business_hours:'',
            delivery_info:'',share_title:'FreshWay',share_description:'Fresh groceries'
          };
          throw new Error('Unexpected first() SQL: '+sql);
        },
        async all(){
          if(sql.startsWith('SELECT product_id,name,unit,qty,price,line_total'))return {results:[{
            product_id:'oil-1',name:'Groundnut Oil',unit:'1 L',qty:1,price:100,line_total:100,
            hsn_code:'',gst_rate_bps:0,gst_rate_confirmed:0
          }]};
          throw new Error('Unexpected all() SQL: '+sql);
        }
      };
      prepared.push(statement);
      return statement;
    }
  }};
  const issue=await prepareInvoiceIssue(env,'FW-12345678-ABC','Out for Delivery');
  assert.ok(issue);
  const insert=prepared.find(statement=>statement.sql.startsWith('INSERT INTO invoices'));
  assert.ok(insert,'invoice INSERT statement must be prepared');
  assert.equal(insert.params.length,15,'all SQL placeholders must be bound');
  assert.deepEqual(insert.params.slice(0,3),['inv-FW-12345678-ABC','FW-12345678-ABC','customer-1']);
  assert.equal(insert.params[3],'FW');
  assert.equal(insert.params[4],issue.financialYear);
  assert.equal(insert.params[5],'commercial_invoice');
  assert.equal(insert.params[6],issue.financialYear);
  assert.ok(insert.params[7],'issue date must be bound');
  assert.equal(JSON.parse(insert.params[8]).legalName,'FreshWay Foods');
  assert.equal(JSON.parse(insert.params[9]).name,'Test Customer');
  assert.equal(JSON.parse(insert.params[10]).totalPaise,10000);
  assert.equal(insert.params[11],issue.financialYear);
  assert.equal(insert.params[12],'FW-12345678-ABC');
  assert.equal(insert.params[13],'Out for Delivery');
  assert.equal(insert.params[14],'FW-12345678-ABC');
  const itemInsert=prepared.find(statement=>statement.sql.startsWith('INSERT INTO invoice_items'));
  assert.ok(itemInsert,'invoice line items must be prepared');
  assert.equal(itemInsert.params.length,17,'all invoice-item SQL placeholders must be bound');
  assert.match(itemInsert.sql,/NOT EXISTS\(SELECT 1 FROM invoice_items WHERE invoice_id=\? AND product_id=\?\)/,'retries must not duplicate invoice line items');
  assert.deepEqual(itemInsert.params.slice(-2),['inv-FW-12345678-ABC','oil-1']);
});
