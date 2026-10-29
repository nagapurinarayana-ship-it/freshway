import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePromotionRequest } from '../src/promotions-api.js';

const imageData='aGVsbG8=';
const imageMimeType='image/webp';
const validBanner={
  imageData,
  imageMimeType,
  altText:'Groundnut oil 5 litre offer saves ₹150',
  displayOrder:1,
  active:true
};

function promotion(overrides={}) {
  return {
    id:'promo-existing',
    image_data:imageData,
    image_mime_type:imageMimeType,
    alt_text:'Groundnut oil 5 litre offer saves ₹150',
    display_order:1,
    active:1,
    ...overrides
  };
}

function makeEnv(initialPromotions=[]) {
  const records=initialPromotions.map(row=>({...row}));
  const writes={insert:0,update:0,delete:0};
  const DB={
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if(sql.startsWith('SELECT * FROM home_promotions WHERE id=?')) {
                const row=records.find(item=>item.id===args[0]);
                return row?{...row}:null;
              }
              throw new Error('Unexpected first() query in promotion test: '+sql);
            },
            async all() {
              if(sql.startsWith('SELECT id,alt_text FROM home_promotions WHERE id<>?')) {
                return {results:records.filter(item=>item.id!==args[0]).map(({id,alt_text})=>({id,alt_text}))};
              }
              if(sql.includes('FROM home_promotions')) {
                const activeOnly=sql.includes('WHERE active=1');
                return {results:records.filter(item=>!activeOnly||Number(item.active)===1).map(item=>({...item}))};
              }
              throw new Error('Unexpected all() query in promotion test: '+sql);
            },
            async run() {
              if(sql.startsWith('INSERT INTO home_promotions')) {
                writes.insert++;
                const [id,image_data,image_mime_type,alt_text,display_order,active]=args;
                records.push({id,image_data,image_mime_type,alt_text,display_order,active});
                return {meta:{changes:1}};
              }
              if(sql.startsWith('UPDATE home_promotions SET')) {
                writes.update++;
                const [image_data,image_mime_type,alt_text,display_order,active,id]=args;
                const row=records.find(item=>item.id===id);
                if(row)Object.assign(row,{image_data,image_mime_type,alt_text,display_order,active});
                return {meta:{changes:row?1:0}};
              }
              if(sql.startsWith('DELETE FROM home_promotions')) {
                writes.delete++;
                const index=records.findIndex(item=>item.id===args[0]);
                if(index<0)return {meta:{changes:0}};
                records.splice(index,1);
                return {meta:{changes:1}};
              }
              throw new Error('Unexpected run() query in promotion test: '+sql);
            }
          };
        }
      };
    }
  };
  return {DB,records,writes};
}

function request(path,method,payload) {
  return new Request('https://freshway.test'+path,{
    method,
    headers:{'content-type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
}

async function json(response) {
  return response.json();
}

test('new promotions require a descriptive image alt text',async()=>{
  for(const altText of ['', '   ', 'Promotion', 'FreshWay promotion', 'Image preview', 'OK']) {
    const env=makeEnv();
    const response=await handlePromotionRequest(request('/api/admin/promotions','POST',{...validBanner,altText}),env);
    assert.equal(response.status,400,`expected ${JSON.stringify(altText)} to be rejected`);
    assert.match((await json(response)).error,/meaningful image description/i);
    assert.equal(env.writes.insert,0);
  }
});

test('creates a promotion with a normalized, descriptive, unique image description',async()=>{
  const env=makeEnv();
  const response=await handlePromotionRequest(request('/api/admin/promotions','POST',{
    ...validBanner,
    altText:'  Groundnut   oil 5 litre offer saves ₹150  '
  }),env);
  assert.equal(response.status,201);
  assert.equal(env.records.length,1);
  assert.equal(env.records[0].alt_text,'Groundnut oil 5 litre offer saves ₹150');
});

test('rejects duplicate promotion descriptions case-insensitively and after whitespace normalization',async()=>{
  const env=makeEnv([promotion({alt_text:'Buy 5ltr get ₹150 off'})]);
  const response=await handlePromotionRequest(request('/api/admin/promotions','POST',{
    ...validBanner,
    altText:'  BUY   5LTR GET ₹150 OFF '
  }),env);
  assert.equal(response.status,400);
  assert.match((await json(response)).error,/unique image description/i);
  assert.equal(env.records.length,1);
  assert.equal(env.writes.insert,0);
});

test('does not allow a hidden legacy promotion with missing alt text to be activated',async()=>{
  const env=makeEnv([promotion({id:'legacy-empty',alt_text:'',active:0})]);
  const response=await handlePromotionRequest(request('/api/admin/promotions/legacy-empty','PATCH',{active:true}),env);
  assert.equal(response.status,400);
  assert.match((await json(response)).error,/meaningful image description/i);
  assert.equal(env.writes.update,0);
});

test('allows a legacy banner with missing alt text to be hidden without rewriting its description',async()=>{
  const env=makeEnv([promotion({id:'legacy-empty',alt_text:'',active:1})]);
  const response=await handlePromotionRequest(request('/api/admin/promotions/legacy-empty','PATCH',{active:false}),env);
  assert.equal(response.status,200);
  assert.equal(env.records[0].active,0);
  assert.equal(env.records[0].alt_text,'');
  assert.equal(env.writes.update,1);
});

test('allows a legacy duplicate-description banner to be hidden without rewriting the shared text',async()=>{
  const shared='Buy 5ltr get ₹150 off';
  const env=makeEnv([
    promotion({id:'legacy-duplicate',alt_text:shared,active:1}),
    promotion({id:'other-duplicate',alt_text:shared,active:1,display_order:2})
  ]);
  const response=await handlePromotionRequest(request('/api/admin/promotions/legacy-duplicate','PATCH',{active:false}),env);
  assert.equal(response.status,200);
  assert.equal(env.records[0].active,0);
  assert.equal(env.records[0].alt_text,shared);
  assert.equal(env.writes.update,1);
});

test('prevents a duplicated legacy description from being reactivated until corrected',async()=>{
  const shared='Buy 5ltr get ₹150 off';
  const env=makeEnv([
    promotion({id:'legacy-duplicate',alt_text:shared,active:0}),
    promotion({id:'other-duplicate',alt_text:shared,active:1,display_order:2})
  ]);
  const response=await handlePromotionRequest(request('/api/admin/promotions/legacy-duplicate','PATCH',{active:true}),env);
  assert.equal(response.status,400);
  assert.match((await json(response)).error,/unique image description/i);
  assert.equal(env.records[0].active,0);
  assert.equal(env.writes.update,0);
});

test('allows a legacy duplicate description to be corrected and activated',async()=>{
  const shared='Buy 5ltr get ₹150 off';
  const env=makeEnv([
    promotion({id:'legacy-duplicate',alt_text:shared,active:0}),
    promotion({id:'other-duplicate',alt_text:shared,active:1,display_order:2})
  ]);
  const response=await handlePromotionRequest(request('/api/admin/promotions/legacy-duplicate','PATCH',{
    active:true,
    altText:'5 litre groundnut oil offer — save ₹150'
  }),env);
  assert.equal(response.status,200);
  assert.equal(env.records[0].active,1);
  assert.equal(env.records[0].alt_text,'5 litre groundnut oil offer — save ₹150');
  assert.equal(env.writes.update,1);
});
