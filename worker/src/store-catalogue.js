// Store-level catalogue configuration is intentionally separate from physical inventory.
// A NULL local price means "use the central catalogue price".
export async function ensureStoreCatalogueRows(env, storeId = '') {
  if (storeId) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO delivery_store_catalogue (store_id,product_id,is_available,price_override) ' +
      'SELECT ?,p.id,1,NULL FROM products p'
    ).bind(storeId).run();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) ' +
      'SELECT ?,p.id,0 FROM products p WHERE p.stock_managed=1'
    ).bind(storeId).run();
    return;
  }
  await env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_catalogue (store_id,product_id,is_available,price_override) ' +
    'SELECT s.id,p.id,1,NULL FROM delivery_stores s CROSS JOIN products p'
  ).run();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO delivery_store_inventory (store_id,product_id,stock_quantity) ' +
    'SELECT s.id,p.id,0 FROM delivery_stores s CROSS JOIN products p WHERE p.stock_managed=1'
  ).run();
}

export async function assertActiveStore(env, storeId) {
  const store = await env.DB.prepare(
    'SELECT id,name,is_active,latitude,longitude,service_radius_km FROM delivery_stores WHERE id=? LIMIT 1'
  ).bind(String(storeId || '')).first();
  if (!store || Number(store.is_active) !== 1) throw new Error('The selected delivery store is no longer active. Refresh your delivery location.');
  return store;
}

export async function getStoreCatalogueRows(env, storeId) {
  const store = await env.DB.prepare('SELECT id FROM delivery_stores WHERE id=? LIMIT 1').bind(String(storeId || '')).first();
  if (!store) throw new Error('Delivery store not found.');
  const { results } = await env.DB.prepare(
    'SELECT p.id,p.name,p.unit,p.price central_price,p.emoji,p.active,p.category_id,p.display_order,' +
    'p.image_data,p.image_mime_type,p.updated_at,p.stock_managed,p.stock_quantity,p.low_stock_threshold,' +
    'p.hsn_code,p.gst_rate_bps,p.gst_rate_confirmed,c.name category_name,c.slug category_slug,c.active category_active,' +
    'sc.is_available,sc.price_override,COALESCE(sc.price_override,p.price) effective_price,' +
    'COALESCE(i.stock_quantity,0) on_hand,' +
    'COALESCE((SELECT SUM(r.qty) FROM delivery_store_inventory_reservations r ' +
    'WHERE r.store_id=sc.store_id AND r.product_id=p.id AND r.status IN (\'reserved\',\'conflict\')),0) reserved_qty ' +
    'FROM delivery_store_catalogue sc JOIN products p ON p.id=sc.product_id ' +
    'JOIN categories c ON c.id=p.category_id ' +
    'LEFT JOIN delivery_store_inventory i ON i.store_id=sc.store_id AND i.product_id=p.id ' +
    'WHERE sc.store_id=? AND p.active=1 AND c.active=1 ORDER BY CASE WHEN c.display_order IS NULL THEN 999999 ELSE c.display_order END,' +
    'c.name,p.display_order,p.name'
  ).bind(storeId).all();
  return results || [];
}

export async function getStoreProductRows(env, storeId, quantities) {
  await assertActiveStore(env, storeId);
  if (!quantities || !quantities.size) return [];
  const ids=[...quantities.keys()].map(String);
  const placeholders=ids.map(()=>'?').join(',');
  const { results }=await env.DB.prepare(
    'SELECT p.id,p.name,p.unit,p.price central_price,p.emoji,p.active,p.category_id,'+
    'p.stock_managed,p.stock_quantity,p.low_stock_threshold,p.hsn_code,p.gst_rate_bps,p.gst_rate_confirmed,'+
    'c.name category_name,c.slug category_slug,c.active category_active,'+
    'sc.is_available,sc.price_override,COALESCE(sc.price_override,p.price) effective_price,'+
    'COALESCE(i.stock_quantity,0) on_hand,'+
    "COALESCE((SELECT SUM(r.qty) FROM delivery_store_inventory_reservations r "+
    "WHERE r.store_id=sc.store_id AND r.product_id=p.id AND r.status IN ('reserved','conflict')),0) reserved_qty "+
    'FROM delivery_store_catalogue sc JOIN products p ON p.id=sc.product_id '+
    'JOIN categories c ON c.id=p.category_id '+
    'LEFT JOIN delivery_store_inventory i ON i.store_id=sc.store_id AND i.product_id=p.id '+
    'WHERE sc.store_id=? AND sc.product_id IN ('+placeholders+')'
  ).bind(storeId,...ids).all();
  const byId=new Map((results||[]).map(row=>[String(row.id),row]));
  const items=[];
  for(const [rawId,rawQty] of quantities){
    const productId=String(rawId),qty=Number(rawQty),row=byId.get(productId);
    if(!row||Number(row.active)!==1||Number(row.category_active)!==1||Number(row.is_available)!==1)
      throw new Error('One or more products are not available from the selected store. Review your cart.');
    if(!Number.isInteger(qty)||qty<1||qty>99)throw new Error('The cart contains an invalid item quantity.');
    const managed=Number(row.stock_managed)===1;
    const available=Math.max(0,Number(row.on_hand||0)-Number(row.reserved_qty||0));
    if(managed&&available<qty)throw new Error('Not enough store stock for '+row.name+'. Review your cart and try again.');
    const price=Number(row.effective_price);
    items.push({...row,price,qty,lineTotal:price*qty,stockReservedQty:managed?qty:0});
  }
  if(items.length!==quantities.size)throw new Error('One or more products are no longer available from the selected store.');
  return items;
}

export async function saveStoreCatalogue(env, storeId, rawItems) {
  const store = await env.DB.prepare('SELECT id FROM delivery_stores WHERE id=? LIMIT 1').bind(storeId).first();
  if (!store) throw new Error('Delivery store not found.');
  if (!Array.isArray(rawItems) || rawItems.length > 500) throw new Error('Enter a valid store catalogue.');
  await ensureStoreCatalogueRows(env, storeId);
  const products = (await env.DB.prepare('SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 AND c.active=1 ORDER BY p.id').all()).results || [];
  const productIds = new Set(products.map(row => String(row.id)));
  const requested = new Map();
  for (const item of rawItems) {
    const productId = String(item?.productId ?? item?.id ?? '').trim();
    if (!productId || !productIds.has(productId) || requested.has(productId)) throw new Error('The store catalogue contains an invalid or duplicate product.');
    if (typeof item.isAvailable !== 'boolean') throw new Error('Choose whether each product is available at this store.');
    let priceOverride = null;
    if (item.priceOverride !== null && item.priceOverride !== undefined && item.priceOverride !== '') {
      priceOverride = Number(item.priceOverride);
      if (!Number.isSafeInteger(priceOverride) || priceOverride < 0 || priceOverride > 10000000) {
        throw new Error('Enter a valid store selling price in whole rupees, or leave it blank to use the central price.');
      }
    }
    requested.set(productId, { isAvailable: item.isAvailable ? 1 : 0, priceOverride });
  }
  if (requested.size !== products.length) throw new Error('Refresh the store catalogue and save every listed product.');
  const statements = [...requested.entries()].map(([productId, value]) =>
    env.DB.prepare(
      'UPDATE delivery_store_catalogue SET is_available=?,price_override=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND product_id=?'
    ).bind(value.isAvailable, value.priceOverride, storeId, productId)
  );
  if (statements.length) await env.DB.batch(statements);
  return getStoreCatalogueRows(env, storeId);
}
