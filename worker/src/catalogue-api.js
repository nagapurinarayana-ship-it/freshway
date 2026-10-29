export async function handleCatalogueRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    const imageMatch = path.match(/^\/api\/catalogue\/images\/(products|categories)\/([^/]+)$/);
    if (imageMatch && request.method === 'GET') {
      let entityId;
      try { entityId = decodeURIComponent(imageMatch[2]); } catch (_) { return imageNotFound(); }
      return publicCatalogueImage(request, env, imageMatch[1], entityId);
    }
    if (path === '/api/categories' && request.method === 'GET') return json(await publicCategories(env));
    if (path === '/api/products' && request.method === 'GET') return json(await publicProducts(env));
    if (path === '/api/admin/catalogue' && request.method === 'GET') return json(await adminCatalogue(env));
    if (path === '/api/admin/categories' && request.method === 'POST') return json(await createCategory(env, await readBody(request)), 201);
    if (path.startsWith('/api/admin/categories/') && request.method === 'PATCH') return json(await updateCategory(env, decodeURIComponent(path.split('/').pop()), await readBody(request)));
    if (path.startsWith('/api/admin/categories/') && request.method === 'DELETE') return json(await deleteCategory(env, decodeURIComponent(path.split('/').pop())));
    if (path === '/api/admin/catalogue/products' && request.method === 'POST') return json(await createProduct(env, await readBody(request)), 201);
    if (path.startsWith('/api/admin/catalogue/products/') && request.method === 'PATCH') return json(await updateProduct(env, decodeURIComponent(path.split('/').pop()), await readBody(request)));
    if (path.startsWith('/api/admin/catalogue/products/') && request.method === 'DELETE') return json(await deleteProduct(env, decodeURIComponent(path.split('/').pop())));
    return null;
  } catch (e) { return json({error:e?.message||'Catalogue request failed.'},400); }
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const readBody=async r=>{try{return await r.json()}catch(_){return{}}};
const clean=(v,max)=>String(v??'').trim().slice(0,max);
const slugify=v=>clean(v,80).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
const id=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
const stockStatus=(managed,quantity,threshold)=>!managed?'not_tracked':Number(quantity)<=0?'out_of_stock':Number(quantity)<=Number(threshold||0)?'low_stock':'in_stock';
const MAX_IMAGE_DATA=900000;
function imageFields(p,label='Product'){const imageData=p.imageData===null||p.imageData===undefined?null:String(p.imageData||'').trim();const imageMimeType=clean(p.imageMimeType||p.image_mime_type||'',40);if(imageData===null||imageData==='')return{imageData:null,imageMimeType:null};if(imageData.length>MAX_IMAGE_DATA)throw new Error(`${label} image is too large. Please use a smaller image.`);if(!/^[A-Za-z0-9+/=]+$/.test(imageData))throw new Error(`${label} image data is invalid.`);if(!/^image\/(png|jpe?g|webp)$/.test(imageMimeType))throw new Error(`${label} image format must be PNG, JPEG, or WebP.`);return{imageData,imageMimeType}}
function imageVersion(row) {
  return encodeURIComponent([
    row.updated_at || '',
    row.image_length || 0,
    row.image_head || '',
    row.image_tail || ''
  ].join('|'));
}
function publicImageUrl(type, row) {
  if (Number(row.has_custom_image) !== 1) return null;
  return '/api/catalogue/images/' + type + '/' + encodeURIComponent(row.id) + '?v=' + imageVersion(row);
}
async function publicProducts(env) {
  const query = "SELECT p.id,p.name,p.unit,p.price,p.emoji,p.active,p.category_id,p.display_order," +
    "CASE WHEN p.image_data IS NOT NULL AND p.image_data <> '' THEN 1 ELSE 0 END AS has_custom_image," +
    "LENGTH(p.image_data) AS image_length,SUBSTR(p.image_data,1,12) AS image_head," +
    "SUBSTR(p.image_data,-12) AS image_tail,p.updated_at,p.stock_managed,p.stock_quantity,p.low_stock_threshold," +
    "c.name AS category_name,c.slug AS category_slug " +
    "FROM products p LEFT JOIN categories c ON c.id=p.category_id " +
    "WHERE p.active=1 AND c.active=1 ORDER BY c.display_order,c.name,p.display_order,p.name";
  const { results } = await env.DB.prepare(query).all();
  return { products: (results || []).map(p => {
    const { has_custom_image, image_length, image_head, image_tail, updated_at,
      stock_managed, stock_quantity, low_stock_threshold, ...product } = p;
    return {
      ...product,
      image_url: publicImageUrl('products', { id: p.id, has_custom_image, image_length, image_head, image_tail, updated_at }),
      stock_status: stockStatus(stock_managed, stock_quantity, low_stock_threshold)
    };
  }) };
}
async function publicCategories(env) {
  const query = "SELECT c.id,c.name,c.slug,c.icon,c.description,c.display_order,c.updated_at," +
    "MAX(CASE WHEN c.image_data IS NOT NULL AND c.image_data <> '' THEN 1 ELSE 0 END) AS has_custom_image," +
    "MAX(LENGTH(c.image_data)) AS image_length,MAX(SUBSTR(c.image_data,1,12)) AS image_head," +
    "MAX(SUBSTR(c.image_data,-12)) AS image_tail,COUNT(p.id) AS product_count " +
    "FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.active=1 " +
    "WHERE c.active=1 GROUP BY c.id,c.name,c.slug,c.icon,c.description,c.display_order,c.updated_at " +
    "HAVING COUNT(p.id)>0 ORDER BY c.display_order ASC,c.name ASC";
  const { results } = await env.DB.prepare(query).all();
  return { categories: (results || []).map(c => {
    const { has_custom_image, image_length, image_head, image_tail, updated_at, ...category } = c;
    return {
      ...category,
      image_url: publicImageUrl('categories', { id: c.id, has_custom_image, image_length, image_head, image_tail, updated_at })
    };
  }) };
}
function imageNotFound() {
  return new Response('Image not found.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  });
}
async function publicCatalogueImage(request, env, type, entityId) {
  const row = type === 'products'
    ? await env.DB.prepare("SELECT p.image_data,p.image_mime_type FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.active=1 AND c.active=1").bind(entityId).first()
    : await env.DB.prepare("SELECT c.image_data,c.image_mime_type FROM categories c WHERE c.id=? AND c.active=1 AND EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id AND p.active=1)").bind(entityId).first();
  const mime = String(row && row.image_mime_type || '').toLowerCase();
  const base64 = String(row && row.image_data || '');
  if (!row || !base64 || base64.length > MAX_IMAGE_DATA ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || !/^image\/(?:png|jpe?g|webp)$/.test(mime)) {
    return imageNotFound();
  }
  let binary;
  try { binary = atob(base64); } catch (_) { return imageNotFound(); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const etag = '"' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') + '"';
  const headers = new Headers({
    'content-type': mime,
    'content-length': String(bytes.byteLength),
    'cache-control': 'public, max-age=31536000, immutable',
    'etag': etag,
    'x-content-type-options': 'nosniff'
  });
  const suppliedEtags = String(request.headers.get('if-none-match') || '').split(',').map(value => value.trim());
  if (suppliedEtags.some(value => value === '*' || value.replace(/^W\//, '') === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(bytes, { status: 200, headers });
}
async function adminCatalogue(env){
  const {results}=await env.DB.prepare(`SELECT c.id,c.name,c.slug,c.icon,c.image_data,c.image_mime_type,c.description,c.display_order,c.active,COUNT(p.id) product_count,COALESCE(SUM(CASE WHEN p.active=1 THEN 1 ELSE 0 END),0) active_product_count,COALESCE(SUM(CASE WHEN p.active=0 THEN 1 ELSE 0 END),0) hidden_product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id,c.name,c.slug,c.icon,c.image_data,c.image_mime_type,c.description,c.display_order,c.active ORDER BY c.display_order ASC,c.name ASC`).all();
  const {results:products}=await env.DB.prepare(`SELECT p.id,p.name,p.unit,p.price,p.emoji,p.image_data,p.image_mime_type,p.active,p.category_id,p.display_order,p.stock_managed,p.stock_quantity,p.low_stock_threshold,p.hsn_code,p.gst_rate_bps,p.gst_rate_confirmed,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY CASE WHEN c.display_order IS NULL THEN 999999 ELSE c.display_order END,c.name,p.display_order,p.name`).all();
  const activeStoreCount=Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count||0);
  return{categories:results||[],products:products||[],activeStoreCount};
}
function validCategoryPayload(p){const name=clean(p.name,80);if(!name)throw new Error('Category name is required.');const slug=slugify(p.slug||name);if(!slug)throw new Error('Category slug is invalid.');const image=imageFields(p,'Category');return{name,slug,icon:clean(p.icon||'🛒',8),imageData:image.imageData,imageMimeType:image.imageMimeType,description:clean(p.description,240),displayOrder:Number.isInteger(Number(p.displayOrder))?Number(p.displayOrder):999,active:p.active===false||p.active===0||p.active==='0'?0:1}}
async function createCategory(env,p){const v=validCategoryPayload(p);const existing=await env.DB.prepare('SELECT id FROM categories WHERE slug=?').bind(v.slug).first();if(existing)throw new Error('A category with this name already exists.');const categoryId=id('cat');await env.DB.prepare('INSERT INTO categories (id,name,slug,icon,image_data,image_mime_type,description,display_order,active) VALUES (?,?,?,?,?,?,?,?,?)').bind(categoryId,v.name,v.slug,v.icon,v.imageData,v.imageMimeType,v.description,v.displayOrder,v.active).run();return{ok:true,category:{id:categoryId,...v,product_count:0,active_product_count:0,hidden_product_count:0}}}
async function updateCategory(env,categoryId,p){const current=await env.DB.prepare('SELECT * FROM categories WHERE id=?').bind(categoryId).first();if(!current)throw new Error('Category not found.');const v=validCategoryPayload({...current,...p,imageData:p.imageData===undefined?current.image_data:p.imageData,imageMimeType:p.imageMimeType===undefined?current.image_mime_type:p.imageMimeType});const existing=await env.DB.prepare('SELECT id FROM categories WHERE slug=? AND id<>?').bind(v.slug,categoryId).first();if(existing)throw new Error('A category with this name already exists.');await env.DB.prepare('UPDATE categories SET name=?,slug=?,icon=?,image_data=?,image_mime_type=?,description=?,display_order=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(v.name,v.slug,v.icon,v.imageData,v.imageMimeType,v.description,v.displayOrder,v.active,categoryId).run();return{ok:true}}
async function deleteCategory(env,categoryId){const current=await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(categoryId).first();if(!current)throw new Error('Category not found.');const used=Number((await env.DB.prepare('SELECT COUNT(*) count FROM products WHERE category_id=?').bind(categoryId).first())?.count||0);if(used)throw new Error('This category contains products. Hide the category instead of deleting it.');await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(categoryId).run();return{ok:true}}
async function requireCategory(env,categoryId){const c=await env.DB.prepare('SELECT id,name,active FROM categories WHERE id=?').bind(clean(categoryId,100)).first();if(!c)throw new Error('Select a valid category.');return c}
const units=new Set(['kg','g','litre','ml','piece','packet','box','bottle','dozen']);
async function activeStoreCount(env){
  return Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores WHERE is_active=1').first())?.count||0);
}
async function storeCount(env){
  return Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_stores').first())?.count||0);
}
function inventoryRowsForProduct(env,productId,stockQuantity,activeStores){
  return env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) '+
    'SELECT s.id,?,CASE WHEN ?=1 AND s.is_active=1 THEN ? ELSE 0 END FROM delivery_stores s'
  ).bind(productId,activeStores,stockQuantity);
}
async function createProduct(env,p){
  const name=clean(p.name,100),unit=clean(p.unit,30),price=Number(p.price),emoji=clean(p.emoji||'🛒',8),
    hsnCode=clean(p.hsnCode??p.hsn_code??'',8),gstRateBps=Number(p.gstRateBps??p.gst_rate_bps??0),
    gstRateConfirmed=(p.gstRateConfirmed===true||p.gst_rate_confirmed===true)?1:0,
    categoryId=clean(p.categoryId,100),displayOrder=Number.isInteger(Number(p.displayOrder))?Number(p.displayOrder):999,
    stockManaged=p.stockManaged!==false,requestedStock=Number(p.stockQuantity??0),lowStockThreshold=Number(p.lowStockThreshold??5);
  const image=imageFields(p);
  if(!name||!unit||!Number.isFinite(price)||price<0)throw new Error('Product name, unit and valid price are required.');
  if(!units.has(unit))throw new Error('Select a valid unit.');
  if(!Number.isInteger(requestedStock)||requestedStock<0||!Number.isInteger(lowStockThreshold)||lowStockThreshold<0)throw new Error('Enter valid stock values.');
  if(hsnCode&&!/^\d{4,8}$/.test(hsnCode))throw new Error('HSN code must contain 4 to 8 digits.');
  if(!Number.isInteger(gstRateBps)||gstRateBps<0||gstRateBps>4000)throw new Error('GST rate must be between 0% and 40%, in increments of 0.01%.');
  if(gstRateConfirmed&&!hsnCode)throw new Error('Enter the accountant-confirmed HSN code before confirming a GST rate.');
  await requireCategory(env,categoryId);
  const productId=id('p');
  const activeStores=stockManaged?await activeStoreCount(env):0;
  const allStores=stockManaged?await storeCount(env):0;
  // Store stock is the source of truth once any active store exists. Never put
  // unallocated stock into the global aggregate when there are multiple stores.
  const stockQuantity=stockManaged&&activeStores>1?0:requestedStock;
  const statements=[env.DB.prepare(
    'INSERT INTO products (id,name,unit,price,emoji,image_data,image_mime_type,active,category_id,display_order,stock_managed,stock_quantity,low_stock_threshold,hsn_code,gst_rate_bps,gst_rate_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(productId,name,unit,Math.round(price),emoji,image.imageData,image.imageMimeType,1,categoryId,displayOrder,
    stockManaged?1:0,stockQuantity,lowStockThreshold,hsnCode,gstRateBps,gstRateConfirmed)];
  if(stockManaged&&allStores>0)statements.push(inventoryRowsForProduct(env,productId,requestedStock,activeStores));
  await env.DB.batch(statements);
  const stockAllocationRequired=Boolean(stockManaged&&activeStores>1&&requestedStock>0);
  return{ok:true,stockAllocationRequired,product:{id:productId,name,unit,price:Math.round(price),emoji,active:1,
    category_id:categoryId,display_order:displayOrder,stock_managed:stockManaged?1:0,stock_quantity:stockQuantity,
    low_stock_threshold:lowStockThreshold,hsn_code:hsnCode,gst_rate_bps:gstRateBps,gst_rate_confirmed:gstRateConfirmed,
    image_data:image.imageData,image_mime_type:image.imageMimeType}};
}
async function updateProduct(env,productId,p){
  const current=await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(productId).first();
  if(!current)throw new Error('Product not found.');
  const next={...current,...p},name=clean(next.name,100),unit=clean(next.unit,30),price=Number(next.price),
    emoji=clean(next.emoji||'🛒',8),hsnCode=clean(p.hsnCode??p.hsn_code??current.hsn_code??'',8),
    gstRateBps=Number(p.gstRateBps??p.gst_rate_bps??current.gst_rate_bps??0),
    gstRateConfirmed=p.gstRateConfirmed===undefined&&p.gst_rate_confirmed===undefined?Number(current.gst_rate_confirmed||0):(p.gstRateConfirmed===true||p.gst_rate_confirmed===true?1:0),
    categoryId=clean(next.categoryId||next.category_id,100),
    displayOrder=Number.isInteger(Number(next.displayOrder??next.display_order))?Number(next.displayOrder??next.display_order):999,
    stockManaged=next.stockManaged!==undefined?Boolean(next.stockManaged):Boolean(current.stock_managed),
    requestedStock=Number(next.stockQuantity??current.stock_quantity??0),
    lowStockThreshold=Number(next.lowStockThreshold??current.low_stock_threshold??5);
  const image=imageFields({...p,imageData:p.imageData===undefined?current.image_data:p.imageData,imageMimeType:p.imageMimeType===undefined?current.image_mime_type:p.imageMimeType});
  if(!name||!unit||!Number.isFinite(price)||price<0)throw new Error('Enter a valid name, price and unit.');
  if(!units.has(unit))throw new Error('Select a valid unit.');
  if(Number(current.stock_managed)===1&&!stockManaged)throw new Error('Stock tracking cannot be disabled after it is enabled.');
  if(!Number.isInteger(requestedStock)||requestedStock<0||!Number.isInteger(lowStockThreshold)||lowStockThreshold<0)throw new Error('Enter valid stock values.');
  if(hsnCode&&!/^\d{4,8}$/.test(hsnCode))throw new Error('HSN code must contain 4 to 8 digits.');
  if(!Number.isInteger(gstRateBps)||gstRateBps<0||gstRateBps>4000)throw new Error('GST rate must be between 0% and 40%, in increments of 0.01%.');
  if(gstRateConfirmed===1&&!hsnCode)throw new Error('Enter the accountant-confirmed HSN code before confirming a GST rate.');
  await requireCategory(env,categoryId);
  const wasManaged=Number(current.stock_managed)===1;
  const activeStores=stockManaged?await activeStoreCount(env):0;
  const allStores=stockManaged?await storeCount(env):0;
  // Once store-level stock is configured, quantity changes belong in the Store
  // Inventory screen. Catalogue edits must not overwrite the aggregate with a
  // stale quantity from the product form.
  const changingToManaged=!wasManaged&&stockManaged;
  const mayEditGlobalStock=!stockManaged||activeStores===0;
  const stockQuantity=stockManaged&&activeStores>1&&changingToManaged?0:
    (wasManaged&&stockManaged&&!mayEditGlobalStock?Number(current.stock_quantity||0):requestedStock);
  const statements=[env.DB.prepare(
    'UPDATE products SET name=?,unit=?,price=?,emoji=?,image_data=?,image_mime_type=?,active=?,category_id=?,display_order=?,stock_managed=?,stock_quantity=?,low_stock_threshold=?,hsn_code=?,gst_rate_bps=?,gst_rate_confirmed=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(name,unit,Math.round(price),emoji,image.imageData,image.imageMimeType,next.active?1:0,categoryId,displayOrder,
    stockManaged?1:0,stockQuantity,lowStockThreshold,hsnCode,gstRateBps,gstRateConfirmed,productId)];
  if(changingToManaged&&allStores>0)statements.push(inventoryRowsForProduct(env,productId,requestedStock,activeStores));
  else if(wasManaged&&stockManaged&&allStores>0){
    statements.push(env.DB.prepare(
      'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) SELECT s.id,?,0 FROM delivery_stores s'
    ).bind(productId));
  }
  const results=await env.DB.batch(statements);
  if(!results?.[0]?.meta?.changes)throw new Error('Product not found.');
  const stockAllocationRequired=Boolean(changingToManaged&&activeStores>1&&requestedStock>0);
  return{ok:true,stockAllocationRequired,stock_managed:stockManaged?1:0,stock_quantity:stockQuantity,
    low_stock_threshold:lowStockThreshold,hsn_code:hsnCode,gst_rate_bps:gstRateBps,gst_rate_confirmed:gstRateConfirmed};
}
async function deleteProduct(env,productId){const used=Number((await env.DB.prepare('SELECT COUNT(*) count FROM order_items WHERE product_id=?').bind(productId).first())?.count||0);if(used)throw new Error('This product is part of existing orders. Hide it instead of deleting it.');const result=await env.DB.prepare('DELETE FROM products WHERE id=?').bind(productId).run();if(!result.meta?.changes)throw new Error('Product not found.');return{ok:true}}

export { createProduct, updateProduct };
