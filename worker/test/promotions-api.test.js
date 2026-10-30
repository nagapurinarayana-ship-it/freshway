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
      const handlers=args=>({
        async first() {
          if(sql.startsWith('SELECT * FROM home_promotions WHERE id=?')) {
            const row=records.find(item=>item.id===args[0]);
            return row?{...row}:null;
          }
          if(sql.startsWith('SELECT image_data,image_mime_type FROM home_promotions WHERE id=? AND active=1')) {
            const row=records.find(item=>item.id===args[0]&&Number(item.active)===1);
            return row?{image_data:row.image_data,image_mime_type:row.image_mime_type}:null;
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
      });
      return {...handlers([]),bind(...args){return handlers(args)}};
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


test('public promotion metadata returns compact image URLs without Base64 payloads',async()=>{
  const env=makeEnv([promotion()]);
  const response=await handlePromotionRequest(request('/api/promotions','GET'),env);
  assert.equal(response.status,200);
  const body=await json(response);
  assert.equal(body.promotions.length,1);
  assert.match(body.promotions[0].image_url,/^\/api\/promotions\/images\/promo-existing\?v=[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(body.promotions[0],'image_data'),false);
  assert.equal(Object.hasOwn(body.promotions[0],'image_mime_type'),false);
  assert.equal(body.promotions[0].alt_text,'Groundnut oil 5 litre offer saves ₹150');
});

test('admin promotion catalogue retains image payloads for Owner editing',async()=>{
  const env=makeEnv([promotion()]);
  const response=await handlePromotionRequest(request('/api/admin/promotions','GET'),env);
  assert.equal(response.status,200);
  const body=await json(response);
  assert.equal(body.promotions[0].image_data,imageData);
  assert.equal(body.promotions[0].image_mime_type,imageMimeType);
  assert.equal(Object.hasOwn(body.promotions[0],'image_url'),false);
});

test('public promotion image endpoint serves immutable binary data with ETags and 304',async()=>{
  const bytes=Uint8Array.from([0x52,0x49,0x46,0x46,0x08,0x00,0x00,0x00,0x57,0x45,0x42,0x50]);
  const env=makeEnv([promotion({image_data:Buffer.from(bytes).toString('base64')})]);
  const url='https://freshway.test/api/promotions/images/promo-existing?v=v1';
  const response=await handlePromotionRequest(new Request(url),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/webp');
  assert.match(response.headers.get('cache-control')||'',/public, max-age=31536000, immutable/);
  assert.match(response.headers.get('etag')||'',/^"[a-f0-9]{64}"$/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())),Array.from(bytes));
  const head=await handlePromotionRequest(new Request(url,{method:'HEAD'}),env);
  assert.equal(head.status,200);
  assert.equal(head.headers.get('content-type'),'image/webp');
  assert.equal(head.headers.get('content-length'),String(bytes.byteLength));
  assert.equal((await head.arrayBuffer()).byteLength,0);
  const etag=response.headers.get('etag');
  const conditional=await handlePromotionRequest(new Request(url,{headers:{'if-none-match':etag}}),env);
  assert.equal(conditional.status,304);
  assert.equal(conditional.headers.get('etag'),etag);
});

test('public promotion image endpoint hides inactive, missing, and malformed images',async()=>{
  const hidden=makeEnv([promotion({active:0})]);
  const hiddenResponse=await handlePromotionRequest(request('/api/promotions/images/promo-existing','GET'),hidden);
  assert.equal(hiddenResponse.status,404);
  assert.equal(hiddenResponse.headers.get('cache-control'),'no-store');
  const malformed=makeEnv([promotion({image_data:'not-valid-base64!'})]);
  const malformedResponse=await handlePromotionRequest(request('/api/promotions/images/promo-existing','GET'),malformed);
  assert.equal(malformedResponse.status,404);
  const missing=makeEnv([]);
  const missingResponse=await handlePromotionRequest(request('/api/promotions/images/missing','GET'),missing);
  assert.equal(missingResponse.status,404);
});
