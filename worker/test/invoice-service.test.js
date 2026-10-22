import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInvoiceSettings, updateInvoiceSettings, buildItemTax, prepareInvoiceIssue, backfillMissingInvoices } from '../src/invoice-service.js';

function fakeEnv(initial=null,storeProfile={store_name:'FreshWay',address:'Shop 1, Main Road, Hyderabad'}){
  let row=initial;
  const db={
    prepare(sql){
      let params=[];
      return {
        bind(...values){params=values;return this},
        async first(){if(sql.startsWith('SELECT store_name,about,phone'))return {...storeProfile,about:storeProfile.about||'',phone:storeProfile.phone||'',whatsapp:storeProfile.whatsapp||'',email:storeProfile.email||'',shop_latitude:storeProfile.shop_latitude??null,shop_longitude:storeProfile.shop_longitude??null,business_hours:storeProfile.business_hours||'',delivery_info:storeProfile.delivery_info||'',share_title:storeProfile.share_title||'FreshWay',share_description:storeProfile.share_description||'Fresh groceries'};return row},
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

test('historical invoice backfill is safe and idempotent when no eligible orders are missing invoices',async()=>{
  const env={DB:{prepare(sql){return{
    bind(){return this},
    async first(){return sql.startsWith('SELECT enabled,document_type')?{
      enabled:1,document_type:'commercial_invoice',legal_name:'',business_address:'',
      state_name:'',state_code:'',gstin:'',series_prefix:'FW',footer:'',
      prices_include_tax:0,updated_at:'2026-10-22'
    }:null},
    async all(){assert.match(sql,/delivery_status IN \('Out for Delivery','Delivered'\)/);assert.match(sql,/NOT EXISTS/);return{results:[]}}
  }}}};
  const result=await backfillMissingInvoices(env);
  assert.deepEqual(result,{enabled:true,scanned:0,issued:0,skipped:0,skippedRefunded:0,failed:[]});
});
test('invoice issuance defaults to disabled',async()=>{
  const settings=await getInvoiceSettings(fakeEnv());
  assert.equal(settings.enabled,false);
  assert.equal(settings.documentType,'commercial_invoice');
  assert.equal(settings.seriesPrefix,'FW');
});

test('allows saving all optional billing fields blank while invoice issuance stays disabled',async()=>{
  const env=fakeEnv();
  const settings=await updateInvoiceSettings(env,{
    enabled:false,documentType:'commercial_invoice',legalName:'',
    businessAddress:'',stateName:'',stateCode:'',gstin:'',footer:'',
    seriesPrefix:'FW',pricesIncludeTax:true
  });
  assert.equal(settings.enabled,false);
  assert.equal(settings.legalName,'');
  assert.equal(settings.businessAddress,'');
  assert.equal(settings.stateName,'');
  assert.equal(settings.stateCode,'');
  assert.equal(settings.gstin,'');
  assert.equal(settings.footer,'');
  assert.equal(settings.seriesPrefix,'FW');
});

test('enables a non-GST commercial record using only the saved store name and address',async()=>{
  const env=fakeEnv();
  const settings=await updateInvoiceSettings(env,{
    enabled:true,documentType:'commercial_invoice',legalName:'',
    businessAddress:'',seriesPrefix:'FW',gstin:'',pricesIncludeTax:false
  });
  assert.equal(settings.enabled,true);
  assert.equal(settings.documentType,'commercial_invoice');
  assert.equal(settings.legalName,'');
  assert.equal(settings.businessAddress,'');
  assert.equal(settings.stateCode,'');
  assert.equal(settings.gstin,'');
  assert.equal(settings.pricesIncludeTax,false);
});

test('a missing GSTIN safely enables only a non-GST commercial record',async()=>{
  const env=fakeEnv();
  const settings=await updateInvoiceSettings(env,{
    enabled:true,documentType:'gst_tax_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road',stateName:'Telangana',stateCode:'36',
    gstin:'',seriesPrefix:'FW',pricesIncludeTax:true,footer:'Keep this footer'
  });
  assert.equal(settings.enabled,true);
  assert.equal(settings.documentType,'commercial_invoice');
  assert.match(settings.enableWarning,/enabled as a non-GST commercial invoice\/order record/);
  assert.equal(settings.legalName,'FreshWay Foods');
  assert.equal(settings.businessAddress,'Shop 1, Main Road');
  assert.equal(settings.stateCode,'36');
  assert.equal(settings.gstin,'');
  assert.equal(settings.footer,'Keep this footer');
});
test('does not enable non-GST records without a saved business address, even with optional overrides',async()=>{
  const env=fakeEnv(null,{store_name:'FreshWay',address:''});
  const settings=await updateInvoiceSettings(env,{
    enabled:true,documentType:'commercial_invoice',legalName:'FreshWay Foods',
    businessAddress:'An override cannot replace the Store Profile location',
    seriesPrefix:'FW',gstin:'',pricesIncludeTax:true
  });
  assert.equal(settings.enabled,false);
  assert.match(settings.enableWarning,/complete business address in Store Profile/);
});

test('GST documents keep the tax-inclusive pricing guard',async()=>{
  const env=fakeEnv();
  const settings=await updateInvoiceSettings(env,{
    enabled:true,documentType:'gst_tax_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road',stateName:'Telangana',stateCode:'36',
    gstin:'36ABCDE1234F1Z5',seriesPrefix:'FW',pricesIncludeTax:false
  });
  assert.equal(settings.enabled,false);
  assert.match(settings.enableWarning,/tax-inclusive/);
  assert.equal(settings.pricesIncludeTax,false);
  assert.equal(settings.legalName,'FreshWay Foods');
});

test('saves seller tax details but keeps issuance disabled when state and GSTIN do not match',async()=>{
  const env=fakeEnv();
  const settings=await updateInvoiceSettings(env,{
    enabled:true,documentType:'gst_tax_invoice',legalName:'FreshWay Foods',
    businessAddress:'Shop 1, Main Road',stateName:'Telangana',stateCode:'27',
    gstin:'36ABCDE1234F1Z5',seriesPrefix:'FW',pricesIncludeTax:true
  });
  assert.equal(settings.enabled,false);
  assert.match(settings.enableWarning,/state code must match/);
  assert.equal(settings.stateCode,'27');
  assert.equal(settings.gstin,'36ABCDE1234F1Z5');
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
            enabled:1,document_type:'commercial_invoice',legal_name:'',
            business_address:'',state_name:'',state_code:'',
            gstin:'',series_prefix:'FW',footer:'',prices_include_tax:0,updated_at:'2026-10-22'
          };
          if(sql.startsWith('SELECT store_name,about,phone'))return {
            store_name:'FreshWay',about:'',phone:'',whatsapp:'',email:'',
            address:'Shop 1, Main Road, Hyderabad',shop_latitude:null,shop_longitude:null,business_hours:'',
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
  assert.equal(JSON.parse(insert.params[8]).legalName,'FreshWay','non-GST invoice falls back to the saved store name');
  assert.equal(JSON.parse(insert.params[8]).address,'Shop 1, Main Road, Hyderabad','non-GST invoice falls back to the saved store address');
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
