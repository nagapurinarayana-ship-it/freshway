const MAX_IMAGE_DATA=900000;
const ALLOWED_IMAGE_MIME=new Set(['image/png','image/jpeg','image/webp']);
const clean=(v,max)=>String(v??'').trim().slice(0,max);
const id=()=>`promo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate, max-age=0'}
});

function imageFields(payload){
  const data=payload.imageData===null||payload.imageData===undefined?null:String(payload.imageData||'').trim();
  const mime=clean(payload.imageMimeType||payload.image_mime_type||'',40);
  if(data===null||data==='')return{imageData:null,imageMimeType:null};
  if(data.length>MAX_IMAGE_DATA)throw new Error('Promotion image is too large after compression.');
  if(!/^[A-Za-z0-9+/=]+$/.test(data))throw new Error('Promotion image data is invalid.');
  if(!ALLOWED_IMAGE_MIME.has(mime))throw new Error('Promotion image format must be PNG, JPEG, or WebP.');
  return{imageData:data,imageMimeType:mime};
}

function validPayload(payload,current={}){
  const image=imageFields({
    imageData:payload.imageData===undefined?current.image_data:payload.imageData,
    imageMimeType:payload.imageMimeType===undefined?current.image_mime_type:payload.imageMimeType
  });
  const alt=clean(payload.altText===undefined?current.alt_text:payload.altText,160);
  const order=Number(payload.displayOrder===undefined?current.display_order:payload.displayOrder);
  const active=payload.active===undefined?Number(current.active??1)===1:payload.active===true||payload.active===1;
  if(!Number.isInteger(order)||order<1||order>99999)throw new Error('Promotion display order must be a positive whole number.');
  if(!image.imageData)throw new Error('Promotion image is required.');
  return{...image,altText:alt,displayOrder:order,active};
}

async function promotions(env,includeHidden=false){
  const where=includeHidden?'':' WHERE active=1';
  const {results}=await env.DB.prepare(
    `SELECT id,image_data,image_mime_type,alt_text,display_order,active,created_at,updated_at
     FROM home_promotions${where}
     ORDER BY display_order ASC,id ASC
     LIMIT 20`
  ).all();
  return{promotions:results||[]};
}

async function createPromotion(env,payload){
  const v=validPayload(payload);
  const promotionId=id();
  await env.DB.prepare(
    'INSERT INTO home_promotions (id,image_data,image_mime_type,alt_text,display_order,active) VALUES (?,?,?,?,?,?)'
  ).bind(promotionId,v.imageData,v.imageMimeType,v.altText,v.displayOrder,v.active?1:0).run();
  return{ok:true,promotion:{id:promotionId,image_data:v.imageData,image_mime_type:v.imageMimeType,alt_text:v.altText,display_order:v.displayOrder,active:v.active?1:0}};
}

async function updatePromotion(env,promotionId,payload){
  const current=await env.DB.prepare('SELECT * FROM home_promotions WHERE id=?').bind(promotionId).first();
  if(!current)throw new Error('Promotion not found.');
  const v=validPayload(payload,current);
  await env.DB.prepare(
    'UPDATE home_promotions SET image_data=?,image_mime_type=?,alt_text=?,display_order=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(v.imageData,v.imageMimeType,v.altText,v.displayOrder,v.active?1:0,promotionId).run();
  return{ok:true};
}

async function deletePromotion(env,promotionId){
  const result=await env.DB.prepare('DELETE FROM home_promotions WHERE id=?').bind(promotionId).run();
  if(!result.meta?.changes)throw new Error('Promotion not found.');
  return{ok:true};
}

export async function handlePromotionRequest(request,env){
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/api/promotions'&&request.method==='GET')return json(await promotions(env,false));
    if(path==='/api/admin/promotions'&&request.method==='GET')return json(await promotions(env,true));
    if(path==='/api/admin/promotions'&&request.method==='POST')return json(await createPromotion(env,await request.json()),201);
    if(path.startsWith('/api/admin/promotions/')&&request.method==='PATCH'){
      return json(await updatePromotion(env,decodeURIComponent(path.split('/').pop()),await request.json()));
    }
    if(path.startsWith('/api/admin/promotions/')&&request.method==='DELETE'){
      return json(await deletePromotion(env,decodeURIComponent(path.split('/').pop())));
    }
    return null;
  }catch(e){
    return json({error:e?.message||'Promotion request failed.'},400);
  }
}
