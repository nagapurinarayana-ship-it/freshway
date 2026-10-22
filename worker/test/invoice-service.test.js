import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInvoiceSettings, updateInvoiceSettings, buildItemTax } from '../src/invoice-service.js';

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
