const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=fs.readFileSync('worker/src/promotions-api.js','utf8');
const schema=fs.readFileSync('worker/schema.sql','utf8');
const migration=fs.readFileSync('worker/migrations/0017_home_promotions.sql','utf8');
for(const text of [api,schema,migration]){
  assert.match(text,/home_promotions/);
  assert.match(text,/image_data/);
  assert.match(text,/image_mime_type/);
}
assert.match(api,/MAX_IMAGE_DATA/);
assert.match(api,/image\/webp/);
assert.match(api,/api\/promotions/);
assert.match(api,/api\/admin\/promotions/);
console.log('home promotions backend contract OK');
