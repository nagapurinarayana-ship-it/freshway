import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInvoiceSettings, updateInvoiceSettings } from '../src/invoice-service.js';

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
