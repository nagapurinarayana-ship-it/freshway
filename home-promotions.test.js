const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=fs.readFileSync('worker/src/promotions-api.js','utf8');
const schema=fs.readFileSync('worker/schema.sql','utf8');
const migration=fs.readFileSync('worker/migrations/0017_home_promotions.sql','utf8');
const ownerCatalogue=fs.readFileSync('frontend/admin/catalogue.js','utf8');
const customerPromotions=fs.readFileSync('frontend/customer/promotions.js','utf8');
for(const text of [api,schema,migration]){
  assert.match(text,/home_promotions/);
  assert.match(text,/image_data/);
  assert.match(text,/image_mime_type/);
}
assert.match(api,/MAX_IMAGE_DATA/);
assert.match(api,/image\/webp/);
assert.match(api,/api\/promotions/);
assert.match(api,/api\/admin\/promotions/);
assert.match(api,/function isUsefulAltText/);
assert.match(api,/async function assertUniqueAltText/);
assert.match(api,/allowLegacyAltForHide/);
assert.match(api,/unique image description/i);
assert.ok(ownerCatalogue.includes('id="fwPromoAlt" required minlength="3" maxlength="160"'), 'Owner promotion form must require a meaningful image description');
assert.ok(ownerCatalogue.includes('Description repeated — make it unique'), 'Owner must flag repeated promotional descriptions');
assert.ok(ownerCatalogue.includes('const duplicate=data.promotions.find'), 'Owner must prevent duplicate descriptions before sending an API request');
assert.ok(ownerCatalogue.includes('if(nextActive&&!isUsefulPromoAlt(alt))'), 'Owner must not activate a legacy promotion with a missing or generic description');
assert.ok(ownerCatalogue.includes('if(nextActive&&alt)payload.altText=alt'), 'hiding a legacy banner must not force an immediate description rewrite');
assert.ok(customerPromotions.includes("p.alt_text||'FreshWay promotion'"), 'customer carousel must still provide a text alternative if a legacy record has no description');
console.log('home promotions API, Owner accessibility, and customer fallback contracts OK');
