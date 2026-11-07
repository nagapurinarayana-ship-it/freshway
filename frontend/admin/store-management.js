(function(){
const storeRoot=document.querySelector('#storeManagement'),requestRoot=document.querySelector('#customerRequestsManagement');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,opt={})=>{const r=await fetch('/api'+path,{...opt,credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||d.message||'Request failed.');return d};
let stores=[],editing=null,selectedStoreId=null,inventory=[],storeCatalogue=[],requests=[],storeBusy=false,requestBusy=false,storeRequestVersion=0,storeSaving=false,storeDetailLoading=false,storeLoadError='',storeStockFilter='all';
const money=n=>'₹'+Math.max(0,Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const note=(root,msg,sel)=>{const el=root&&root.querySelector(sel);if(el)el.textContent=msg};
const storeForm=s=>({id:s&&s.id||'',name:s&&s.name||'',address:s&&s.address||'',latitude:s&&s.latitude!=null?s.latitude:'',longitude:s&&s.longitude!=null?s.longitude:'',radius:s&&s.service_radius_km!=null?s.service_radius_km:5,active:s?Number(s.is_active)!==0:false});
function renderStores(){
 if(!storeRoot)return;
 let form='';
 if(editing!==null){form='<form class="panel fw-store-form" id="fwStoreForm"><div class="section-head"><div><h2>'+(editing.id?'Edit store':'Add store')+'</h2><p>Enter the store address and map pin. The default delivery radius is 5 km.</p></div></div><div class="settings-form-grid">'+
 '<label class="settings-field"><span>Store name</span><input name="name" maxlength="120" required value="'+esc(editing.name)+'" placeholder="Store 1"></label>'+
 '<label class="settings-field"><span>Address</span><input name="address" maxlength="300" value="'+esc(editing.address)+'" placeholder="Street, area, city"></label>'+
 '<label class="settings-field"><span>Latitude</span><input name="latitude" type="number" step="any" min="-90" max="90" required value="'+esc(editing.latitude)+'"></label>'+
 '<label class="settings-field"><span>Longitude</span><input name="longitude" type="number" step="any" min="-180" max="180" required value="'+esc(editing.longitude)+'"></label>'+
 '<label class="settings-field"><span>Delivery radius (km)</span><input name="radius" type="number" step="0.1" min="0.1" max="100" required value="'+esc(editing.radius)+'"></label>'+
 (editing.id?'<label class="settings-field"><span>Status</span><select name="active"><option value="1" '+(editing.active?'selected':'')+'>Active</option><option value="0" '+(!editing.active?'selected':'')+'>Inactive</option></select></label>':'')+
 '</div><p class="muted">New stores start inactive. Add actual inventory, then activate the store from Edit when it is ready.</p><div class="settings-actions"><button class="primary" type="submit">Save store</button><button class="ghost" type="button" data-store-cancel>Cancel</button></div></form>';}
 const cards=stores.length?stores.map(s=>'<article class="panel fw-store-card"><div class="section-head"><div><h3>'+esc(s.name)+'</h3><p>'+esc(s.address||'No address added')+'</p></div><span class="fw-store-state '+(Number(s.is_active)===1?'is-active':'is-inactive')+'">'+(Number(s.is_active)===1?'Active':'Inactive')+'</span></div><div class="fw-store-meta"><span>'+esc(s.service_radius_km)+' km radius</span><span>'+esc(s.latitude)+', '+esc(s.longitude)+'</span></div>'+(Number(s.pending_order_count)>0?'<p class="muted">'+Number(s.pending_order_count)+' existing order'+(Number(s.pending_order_count)===1?'':'s')+' remain assigned to this store.</p>':'')+'<div class="fw-store-actions"><a class="ghost" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(s.latitude+','+s.longitude)+'">Open map</a><button class="ghost" data-edit-store="'+esc(s.id)+'" type="button">Edit</button><button class="primary" data-manage-store="'+esc(s.id)+'" data-store-id="'+esc(s.id)+'" type="button">Manage products &amp; stock</button></div></article>').join(''):'<p class="muted">No stores configured yet. Add your first store to begin.</p>';
 const inventoryById=new Map(inventory.map(item=>[String(item.id),item]));
 const catalogueProductIds=new Set(storeCatalogue.map(item=>String(item.id)));
 const managedSummary=inventory.filter(item=>Number(item.stock_managed)===1||item.stock_managed===true).map(item=>{
  const onHand=Number(item.on_hand||0),reserved=Number(item.reserved_qty||0),available=Math.max(0,onHand-reserved),threshold=Number(item.low_stock_threshold||0);
  return {available,threshold,state:available<=0?'out':(threshold>0&&available<=threshold?'low':'healthy')};
 });
 const lowStockCount=managedSummary.filter(item=>item.state==='low').length;
 const outOfStockCount=managedSummary.filter(item=>item.state==='out').length;
 const catalogueRows=storeCatalogue.map(p=>{
  const stock=inventoryById.get(String(p.id));
  const managed=p.stockManaged===true||Number(p.stockManaged)===1;
  const onHand=Number(stock?.on_hand??p.onHand??0),reserved=Number(stock?.reserved_qty??p.reservedQty??0);
  const available=Math.max(0,onHand-reserved),threshold=Number(stock?.low_stock_threshold??p.lowStockThreshold??0);
  const stockState=!managed?'untracked':(available<=0?'out':(threshold>0&&available<=threshold?'low':'healthy'));
  const stockLabel=stockState==='out'?'Out of stock':stockState==='low'?'Low stock':stockState==='healthy'?'In stock':'Not tracked';
  const searchText=(String(p.name||'')+' '+String(p.categoryName||'')).toLowerCase();
  const stockControls=managed
   ?'<label class="fw-managed-field"><span>On-hand quantity</span><input type="number" min="'+reserved+'" step="1" inputmode="numeric" required data-inventory-product="'+esc(p.id)+'" value="'+esc(onHand)+'" aria-label="On-hand quantity for '+esc(p.name)+'"><small>Physical stock kept at this store.</small></label><div class="fw-managed-stock-meta"><span>Reserved <strong>'+reserved+'</strong></span><span>Available <strong data-available-qty>'+available+'</strong></span><span>Low-stock alert <strong>'+threshold+'</strong></span></div>'
   :'<div class="fw-managed-untracked"><span>Physical stock</span><strong>Not tracked</strong><small>Existing non-stock-managed product behaviour is unchanged.</small></div>';
  return '<article class="fw-managed-product" data-managed-product data-stock-state="'+stockState+'" data-search="'+esc(searchText)+'" data-reserved="'+reserved+'" data-low-threshold="'+threshold+'">'+
   '<div class="fw-managed-product-head"><div class="fw-managed-product-name"><h3>'+esc(p.name)+'</h3><p>'+esc(p.categoryName||'Uncategorised')+' · '+esc(p.unit||'')+'</p></div><span class="fw-stock-pill fw-stock-'+stockState+'" data-stock-state-label>'+stockLabel+'</span></div>'+
   '<div class="fw-managed-product-controls">'+
    '<label class="fw-managed-availability"><input type="checkbox" data-catalogue-available="'+esc(p.id)+'" '+(p.isAvailable?'checked':'')+'><span>Sell in this store</span></label>'+
    '<label class="fw-managed-field"><span>Store selling price</span><span class="fw-managed-price-input"><b>₹</b><input type="number" min="0" max="10000000" step="1" inputmode="numeric" data-catalogue-price="'+esc(p.id)+'" value="'+(p.priceOverride==null?'':esc(p.priceOverride))+'" placeholder="Central '+esc(p.centralPrice)+'" aria-label="Selling price for '+esc(p.name)+'"></span><small>Current: '+money(p.storePrice)+' · Central: '+money(p.centralPrice)+' · Blank uses central price</small></label>'+
    stockControls+
   '</div></article>';
 }).join('');
 const inventoryOnlyRows=inventory.filter(p=>(Number(p.stock_managed)===1||p.stock_managed===true)&&!catalogueProductIds.has(String(p.id))).map(p=>{
  const onHand=Number(p.on_hand||0),reserved=Number(p.reserved_qty||0),available=Math.max(0,onHand-reserved),threshold=Number(p.low_stock_threshold||0);
  const stockState=available<=0?'out':(threshold>0&&available<=threshold?'low':'healthy');
  const stockLabel=stockState==='out'?'Out of stock':stockState==='low'?'Low stock':'In stock';
  return '<article class="fw-managed-product fw-managed-inventory-only" data-managed-product data-stock-state="'+stockState+'" data-search="'+esc(String(p.name||'').toLowerCase())+'" data-reserved="'+reserved+'" data-low-threshold="'+threshold+'">'+
   '<div class="fw-managed-product-head"><div class="fw-managed-product-name"><h3>'+esc(p.name)+'</h3><p>'+esc(p.unit||'')+' · Central catalogue hidden or inactive</p></div><span class="fw-stock-pill fw-stock-'+stockState+'" data-stock-state-label>'+stockLabel+'</span></div>'+
   '<div class="fw-managed-product-controls"><div class="fw-managed-untracked"><span>Store selling price</span><strong>Not editable</strong><small>Manage central visibility in Catalogue before selling this product at a store.</small></div>'+
   '<label class="fw-managed-field"><span>On-hand quantity</span><input type="number" min="'+reserved+'" step="1" inputmode="numeric" required data-inventory-product="'+esc(p.id)+'" value="'+esc(onHand)+'" aria-label="On-hand quantity for '+esc(p.name)+'"></label><div class="fw-managed-stock-meta"><span>Reserved <strong>'+reserved+'</strong></span><span>Available <strong data-available-qty>'+available+'</strong></span><span>Low-stock alert <strong>'+threshold+'</strong></span></div></div></article>';
 }).join('');
 const inventoryOnlyCount=inventory.filter(p=>(Number(p.stock_managed)===1||p.stock_managed===true)&&!catalogueProductIds.has(String(p.id))).length;
 const productRows=catalogueRows+inventoryOnlyRows; let management='';
 const productContent=storeDetailLoading?'<p class="muted" role="status">Loading products and stock…</p>':(storeLoadError?'<div class="panel fw-store-load-error"><p class="muted">Prices and inventory could not be loaded for this store.</p><button class="ghost" type="button" data-retry-store-management>Try loading again</button></div>':(productRows||'<p class="muted">No products are available to manage for this store.</p>'));
 if(selectedStoreId){
  const selectedStore=stores.find(item=>String(item.id)===String(selectedStoreId))||{};
  management='<section class="panel fw-store-management-panel"><div class="fw-store-management-heading"><div><span class="eyebrow">STORE PRODUCTS &amp; STOCK</span><h2>'+esc(selectedStore.name||'Store')+'</h2><p>Prices, availability and physical inventory are managed independently for this store.</p></div><div class="fw-store-management-actions"><span class="fw-store-state '+(Number(selectedStore.is_active)===1?'is-active':'is-inactive')+'">'+(Number(selectedStore.is_active)===1?'Active':'Inactive')+'</span><button class="ghost" type="button" data-close-store-management data-close-catalogue data-close-inventory>Back to stores</button></div></div>'+
   '<p data-store-management-status class="muted" role="status" aria-live="polite">Loading this store&#39;s catalogue and inventory…</p>'+
   '<div class="fw-inventory-summary"><div><strong data-store-summary-products>'+(storeDetailLoading?'—':storeCatalogue.length+inventoryOnlyCount)+'</strong><span>Products</span></div><div><strong data-store-summary-low>'+(storeDetailLoading?'—':lowStockCount)+'</strong><span>Low stock</span></div><div><strong data-store-summary-out>'+(storeDetailLoading?'—':outOfStockCount)+'</strong><span>Out of stock</span></div></div>'+
   '<div class="fw-inventory-toolbar"><label class="fw-inventory-search"><span class="sr-only">Search products</span><input type="search" data-store-product-search placeholder="Search product or category" autocomplete="off"></label><div class="fw-stock-filters"><button type="button" class="is-active" aria-pressed="true" data-stock-filter="all">All</button><button type="button" aria-pressed="false" data-stock-filter="low">Low stock</button><button type="button" aria-pressed="false" data-stock-filter="out">Out of stock</button><button type="button" aria-pressed="false" data-stock-filter="untracked">Not tracked</button></div></div>'+
   '<div class="fw-managed-products">'+productContent+'</div>'+(productRows?'<p class="muted" data-store-filter-empty hidden>No products match these filters.</p>':'')+
   '<div class="fw-store-management-save"><p class="muted">Saving updates this store only. Reserved quantities are protected from being reduced.</p><button class="primary" type="button" data-save-store-management data-save-catalogue data-save-inventory>Save prices &amp; inventory</button></div></section>';
 }

 const storesView='<div class="fw-admin-section-head"><div><span class="eyebrow">DELIVERY SETUP</span><h2>Stores</h2><p>Manage locations, 5 km delivery areas and stock by location.</p></div><button class="primary" type="button" data-add-store>+ Add store</button></div><p data-store-status class="muted fw-admin-status" role="status" aria-live="polite">'+stores.length+' store'+(stores.length===1?'':'s')+' loaded.</p>'+form+'<div class="fw-store-grid">'+cards+'</div>';
 storeRoot.innerHTML=selectedStoreId?management:storesView;
}
async function loadStores(){if(!storeRoot||storeBusy||storeSaving)return;storeRequestVersion++;selectedStoreId=null;editing=null;inventory=[];storeCatalogue=[];storeSaving=false;storeDetailLoading=false;storeLoadError='';storeStockFilter='all';storeBusy=true;storeRoot.innerHTML='<p class="muted">Loading stores…</p>';try{const d=await api('/admin/delivery/stores');stores=Array.isArray(d.stores)?d.stores:[];renderStores()}catch(e){storeRoot.innerHTML='<section class="panel"><h2>Could not load stores</h2><p class="muted">'+esc(e.message)+'</p><button class="primary" type="button" data-retry-stores>Try again</button></section>'}finally{storeBusy=false}}
function hasUnsavedStoreChanges(){
 if(!storeRoot)return false;
 if(editing!==null){
  const form=storeRoot.querySelector('#fwStoreForm');
  if(!form)return true;
  const values=new FormData(form);
  for(const field of ['name','address','latitude','longitude'])if(String(values.get(field)??'')!==String(editing[field]??''))return true;
  if(Number(values.get('radius'))!==Number(editing.radius))return true;
  if(editing.id&&(values.get('active')==='1')!==!!editing.active)return true;
  return false;
 }
 if(!selectedStoreId)return false;
 for(const product of storeCatalogue){
  const available=storeRoot.querySelector('[data-catalogue-available="'+CSS.escape(String(product.id))+'"]');
  if(available&&available.checked!==!!product.isAvailable)return true;
  const price=storeRoot.querySelector('[data-catalogue-price="'+CSS.escape(String(product.id))+'"]');
  if(price){
   const raw=String(price.value??'').trim(),next=raw===''?null:Number(raw),saved=product.priceOverride==null?null:Number(product.priceOverride);
   if(next!==saved)return true;
  }
 }
 for(const item of inventory){
  if(Number(item.stock_managed)!==1&&item.stock_managed!==true)continue;
  const input=storeRoot.querySelector('[data-inventory-product="'+CSS.escape(String(item.id))+'"]');
  if(input&&Number(input.value)!==Number(item.on_hand||0))return true;
 }
 return false;
}
function beforeNavigate(){
 if(storeSaving){
  note(storeRoot,'A save is still in progress. Wait for it to finish before navigating.','[data-store-management-status]');
  return false;
 }
 if(!hasUnsavedStoreChanges())return true;
 return typeof window.confirm==='function'
  ? window.confirm('You have unsaved Store changes. Leave this screen and discard them?')
  : false;
}
function historyContext(){
 return selectedStoreId?{storeId:String(selectedStoreId),storeView:'management'}:{};
}
async function refreshStores(){
 if(!storeRoot||storeBusy||storeSaving)return;
 const previousStoreId=selectedStoreId;
 const previousEditing=editing===null?null:{...editing};
 const previousSearch=storeRoot.querySelector('[data-store-product-search]')?.value||'';
 const previousFilter=storeStockFilter;
 if(hasUnsavedStoreChanges()&&!window.confirm('Discard unsaved Store changes and reload from the server?'))return;
 const version=++storeRequestVersion;
 storeBusy=true;
 try{
  const data=await api('/admin/delivery/stores');
  if(version!==storeRequestVersion)return;
  stores=Array.isArray(data.stores)?data.stores:[];
  if(previousStoreId&&stores.some(store=>String(store.id)===String(previousStoreId))){
   storeBusy=false;
   await openStoreManagement(previousStoreId);
   if(selectedStoreId!==previousStoreId)return;
   const search=storeRoot.querySelector('[data-store-product-search]');
   if(search)search.value=previousSearch;
   storeStockFilter=previousFilter;
   applyStoreFilters();
  }else{
   selectedStoreId=null;inventory=[];storeCatalogue=[];storeDetailLoading=false;storeLoadError='';
   if(previousEditing!==null){
    const latest=previousEditing.id?stores.find(store=>String(store.id)===String(previousEditing.id)):null;
    editing=previousEditing.id?(latest?storeForm(latest):null):storeForm(null);
   }else editing=null;
   renderStores();
   if(previousEditing!==null)note(storeRoot,'Store details refreshed. Any discarded form edits were replaced with the latest saved values.','[data-store-status]');
  }
 }catch(error){
  if(version!==storeRequestVersion)return;
  note(storeRoot,'Could not refresh stores: '+(error.message||'Request failed.'),'[data-store-management-status]');
  note(storeRoot,'Could not refresh stores: '+(error.message||'Request failed.'),'[data-store-status]');
 }finally{storeBusy=false}
}
async function openStoreManagement(id){
  if(storeSaving)return;
 const storeId=String(id||'');
 if(!storeId||!stores.some(store=>String(store.id)===storeId))return;
 const version=++storeRequestVersion;
 selectedStoreId=storeId;editing=null;inventory=[];storeCatalogue=[];storeSaving=false;storeDetailLoading=true;storeLoadError='';storeStockFilter='all';
 renderStores();
 const storeStatus=storeRoot.querySelector('[data-store-management-status]');
 if(storeStatus)storeStatus.textContent="Loading this store's prices and inventory…";
 try{
  const base='/admin/delivery/stores/'+encodeURIComponent(storeId);
  const results=await Promise.all([api(base+'/catalogue'),api(base+'/inventory')]);
  if(version!==storeRequestVersion||selectedStoreId!==storeId)return;
  storeCatalogue=Array.isArray(results[0].items)?results[0].items:[];
  inventory=Array.isArray(results[1].inventory)?results[1].inventory:[];
  storeDetailLoading=false;storeLoadError='';
  renderStores();
  note(storeRoot,'Store prices and inventory loaded.','[data-store-management-status]');
 }catch(error){
  if(version!==storeRequestVersion||selectedStoreId!==storeId)return;
  storeDetailLoading=false;storeLoadError=error.message||'Store data could not be loaded.';
  renderStores();
  note(storeRoot,storeLoadError,'[data-store-management-status]');
 }
}
function closeStoreManagement(){
  if(storeSaving)return;
  const state=window.history?.state;
  if(state?.__freshwayOwner&&state.screen==='stores'&&state.storeId&&typeof window.history.back==='function'){window.history.back();return}
 storeRequestVersion++;
 selectedStoreId=null;inventory=[];storeCatalogue=[];storeSaving=false;storeDetailLoading=false;storeLoadError='';storeStockFilter='all';
 renderStores();
}
function updateStoreSummary(){
 if(!storeRoot)return;
 const rows=[...storeRoot.querySelectorAll('[data-managed-product]')];
 const low=rows.filter(row=>row.dataset.stockState==='low').length;
 const out=rows.filter(row=>row.dataset.stockState==='out').length;
 note(storeRoot,String(rows.length),'[data-store-summary-products]');
 note(storeRoot,String(low),'[data-store-summary-low]');
 note(storeRoot,String(out),'[data-store-summary-out]');
}
function setStoreSaving(saving,button){
 if(!storeRoot)return;
 storeRoot.querySelectorAll('[data-catalogue-available],[data-catalogue-price],[data-inventory-product]').forEach(control=>{control.disabled=saving;});
  storeRoot.querySelectorAll('[data-close-store-management]').forEach(control=>{control.disabled=saving;});
 const saveButton=button||storeRoot.querySelector('[data-save-store-management]');
 if(saveButton){saveButton.disabled=saving;saveButton.textContent=saving?'Saving…':'Save prices & inventory';}
}
function applyStoreFilters(){
 if(!storeRoot)return;
 const query=String(storeRoot.querySelector('[data-store-product-search]')?.value||'').trim().toLowerCase();
 const rows=[...storeRoot.querySelectorAll('[data-managed-product]')];
 let visibleCount=0;
 rows.forEach(row=>{
  const state=row.dataset.stockState||'untracked';
  const text=String(row.dataset.search||'');
  const queryMatch=!query||text.includes(query);
  const filterMatch=storeStockFilter==='all'||(storeStockFilter==='low'&&state==='low')||(storeStockFilter==='out'&&state==='out')||(storeStockFilter==='untracked'&&state==='untracked');
  row.hidden=!(queryMatch&&filterMatch);
  if(!row.hidden)visibleCount++;
 });
 const empty=storeRoot.querySelector('[data-store-filter-empty]');
 if(empty)empty.hidden=rows.length===0||visibleCount>0;
 updateStoreSummary();
 storeRoot.querySelectorAll('[data-stock-filter]').forEach(button=>{
  const active=button.dataset.stockFilter===storeStockFilter;
  button.classList.toggle('is-active',active);
  button.setAttribute('aria-pressed',active?'true':'false');
 });
}
async function saveStoreManagement(button){
 if(storeSaving||!selectedStoreId)return;
 const storeId=String(selectedStoreId),version=storeRequestVersion;
 const catalogueItems=storeCatalogue.map(product=>{
  const visible=storeRoot.querySelector('[data-catalogue-available="'+CSS.escape(String(product.id))+'"]');
  const price=storeRoot.querySelector('[data-catalogue-price="'+CSS.escape(String(product.id))+'"]');
  const raw=String(price?.value??'').trim();
  if(raw!==''&&(!Number.isSafeInteger(Number(raw))||Number(raw)<0||Number(raw)>10000000))
   throw new Error('Enter a valid whole-rupee selling price for '+product.name+'.');
  return {productId:product.id,isAvailable:visible?!!visible.checked:!!product.isAvailable,priceOverride:raw===''?null:Number(raw)};
 });
 const inventoryInputs=new Map([...storeRoot.querySelectorAll('[data-inventory-product]')].map(input=>[String(input.dataset.inventoryProduct),input]));
 const inventoryItems=inventory.filter(item=>Number(item.stock_managed)===1||item.stock_managed===true).map(item=>{
  const input=inventoryInputs.get(String(item.id));
  const quantity=Number(input?input.value:item.on_hand??0),reserved=Number(item.reserved_qty||0);
  if(!Number.isInteger(quantity)||quantity<0||quantity<reserved)
   throw new Error('Enter a whole-number on-hand quantity for '+item.name+' that is not below its '+reserved+' reserved units.');
  return {productId:item.id,stockQuantity:quantity};
 });
 storeSaving=true;
 setStoreSaving(true,button);
 const base='/admin/delivery/stores/'+encodeURIComponent(storeId);
 const outcomes=await Promise.allSettled([
  api(base+'/catalogue',{method:'PATCH',body:JSON.stringify({items:catalogueItems})}),
  api(base+'/inventory',{method:'PATCH',body:JSON.stringify({items:inventoryItems})})
 ]);
 if(version!==storeRequestVersion||selectedStoreId!==storeId)return;
 const messages=[];
 const saved=[];
 if(outcomes[0].status==='fulfilled')saved.push('Prices and availability');
 else messages.push('Prices/availability: '+(outcomes[0].reason?.message||'save failed'));
 if(outcomes[1].status==='fulfilled')saved.push('Inventory');
 else messages.push('Inventory: '+(outcomes[1].reason?.message||'save failed'));
 if(messages.length){
  storeSaving=false;
  setStoreSaving(false,button);
  const lead=saved.length?saved.join(' and ')+' saved. ':'Nothing was saved. ';
  note(storeRoot,lead+messages.join(' · ')+'. Your edits are still on screen. Fix the failed section and save again.','[data-store-management-status]');
  return;
 }
 try{
  const refreshed=await Promise.all([api(base+'/catalogue'),api(base+'/inventory')]);
  if(version!==storeRequestVersion||selectedStoreId!==storeId)return;
  storeCatalogue=Array.isArray(refreshed[0].items)?refreshed[0].items:[];
  inventory=Array.isArray(refreshed[1].inventory)?refreshed[1].inventory:[];
  storeSaving=false;
  renderStores();
  applyStoreFilters();
  note(storeRoot,'Prices, availability and inventory saved for this store.','[data-store-management-status]');
 }catch(error){
  if(version!==storeRequestVersion||selectedStoreId!==storeId)return;
  storeSaving=false;
  setStoreSaving(false,button);
  note(storeRoot,'Both save requests succeeded, but the latest values could not be reloaded: '+error.message+' Your edits are still on screen. Refresh the store before making further changes.','[data-store-management-status]');
 }
}
storeRoot&&storeRoot.addEventListener('click',async e=>{
 if(e.target.closest('[data-add-store]')){storeRequestVersion++;selectedStoreId=null;inventory=[];storeCatalogue=[];storeSaving=false;storeDetailLoading=false;storeLoadError='';editing=storeForm(null);renderStores();storeRoot.querySelector('[name="name"]')?.focus();return}
 if(e.target.closest('[data-retry-stores]')){await loadStores();return}
 if(e.target.closest('[data-retry-store-management]')){const id=selectedStoreId;if(id)await openStoreManagement(id);return}
 if(e.target.closest('[data-store-cancel]')){editing=null;renderStores();return}
 const ed=e.target.closest('[data-edit-store]');if(ed){const s=stores.find(x=>x.id===ed.dataset.editStore);if(s){storeRequestVersion++;selectedStoreId=null;inventory=[];storeCatalogue=[];storeSaving=false;storeDetailLoading=false;storeLoadError='';editing=storeForm(s);renderStores();storeRoot.querySelector('[name="name"]')?.focus()}return}
 const manage=e.target.closest('[data-manage-store]');if(manage){e.preventDefault?.();e.stopPropagation?.();const storeId=String(manage.dataset.storeId||manage.dataset.manageStore||'');const state=window.history?.state||{};if(storeId&&window.history?.pushState&&!(state.__freshwayOwner&&state.screen==='stores'&&String(state.storeId||'')===storeId)){window.history.pushState({...state,__freshwayOwner:true,screen:'stores',storeId,storeView:'management'},'',window.location?.href||undefined)}await openStoreManagement(storeId);return}
 if(e.target.closest('[data-close-store-management]')){closeStoreManagement();return}
 const filter=e.target.closest('[data-stock-filter]');if(filter){storeStockFilter=filter.dataset.stockFilter||'all';applyStoreFilters();return}
 const save=e.target.closest('[data-save-store-management],[data-save-catalogue],[data-save-inventory]');if(save){try{await saveStoreManagement(save)}catch(error){note(storeRoot,error.message,'[data-store-management-status]')}return}
});
storeRoot&&storeRoot.addEventListener('input',e=>{
 if(e.target.matches('[data-store-product-search]')){applyStoreFilters();return}
 const input=e.target.closest('[data-inventory-product]');
 if(!input)return;
 const row=input.closest('[data-managed-product]');
 if(!row)return;
 const reserved=Number(row.dataset.reserved||0),threshold=Number(row.dataset.lowThreshold||0);
 const available=Math.max(0,Number(input.value||0)-reserved);
 const state=available<=0?'out':(threshold>0&&available<=threshold?'low':'healthy');
 row.dataset.stockState=state;
 const label=row.querySelector('[data-stock-state-label]');
 if(label){label.textContent=state==='out'?'Out of stock':state==='low'?'Low stock':'In stock';label.className='fw-stock-pill fw-stock-'+state;}
 row.querySelectorAll('[data-available-qty]').forEach(node=>{node.textContent=String(available)});
 updateStoreSummary();
});
storeRoot&&storeRoot.addEventListener('change',e=>{
 if(e.target.matches('[data-inventory-product]'))applyStoreFilters();
});
storeRoot&&storeRoot.addEventListener('submit',async e=>{if(e.target.id!=='fwStoreForm')return;e.preventDefault();const creating=!editing.id;const f=new FormData(e.target),payload={name:String(f.get('name')||'').trim(),address:String(f.get('address')||'').trim(),latitude:Number(f.get('latitude')),longitude:Number(f.get('longitude')),serviceRadiusKm:Number(f.get('radius'))};if(editing.id)payload.isActive=f.get('active')==='1';if(!payload.name||!Number.isFinite(payload.latitude)||Math.abs(payload.latitude)>90||!Number.isFinite(payload.longitude)||Math.abs(payload.longitude)>180||!Number.isFinite(payload.serviceRadiusKm)||payload.serviceRadiusKm<.1||payload.serviceRadiusKm>100){note(storeRoot,'Enter a name, valid coordinates and radius between 0.1 and 100 km.','[data-store-status]');return}if(editing.id&&editing.active&&!payload.isActive){const current=stores.find(s=>s.id===editing.id),pending=Number(current?.pending_order_count||0);if(pending&&!window.confirm('This store has '+pending+' existing order'+(pending===1?'':'s')+' still assigned. Deactivation will not cancel or move them. Continue?'))return}const btn=e.target.querySelector('[type="submit"]');btn.disabled=true;try{if(editing.id)await api('/admin/delivery/stores/'+encodeURIComponent(editing.id),{method:'PATCH',body:JSON.stringify(payload)});else await api('/admin/delivery/stores',{method:'POST',body:JSON.stringify(payload)});editing=null;selectedStoreId=null;inventory=[];storeCatalogue=[];storeRequestVersion++;storeSaving=false;storeDetailLoading=false;storeLoadError='';await loadStores();note(storeRoot,creating?'Store created inactive. Add inventory and activate it when ready.':'Store saved. Existing orders and reservations were left unchanged.','[data-store-status]')}catch(err){note(storeRoot,err.message,'[data-store-status]');btn.disabled=false}});
function typeName(t){return ({cancellation:'Cancellation',reschedule:'Delivery date change',return:'Return',issue:'Order issue'})[t]||'Customer request'}
function renderRequests(){if(!requestRoot)return;const cards=requests.map(r=>'<article class="panel fw-request-card"><div class="section-head"><div><span class="eyebrow">'+esc(typeName(r.request_type))+'</span><h3>Order '+esc(r.order_id)+'</h3><p>'+esc(r.customer_name||'Customer')+(r.customer_phone?' · '+esc(r.customer_phone):'')+'</p></div><span class="fw-store-state '+(r.status==='approved'?'is-active':'is-pending')+'">'+(r.status==='approved'?'Reviewed — resolve':'Pending')+'</span></div><p>'+esc(r.reason||'No additional details provided.')+'</p>'+(r.requested_delivery_date?'<p class="muted">Requested date: <strong>'+esc(r.requested_delivery_date)+'</strong></p>':'')+'<div class="fw-store-actions"><button class="ghost" type="button" data-open-request-order="'+esc(r.order_id)+'">View order</button>'+(r.customer_phone?'<a class="ghost" href="tel:'+esc(r.customer_phone.replace(/[^\d+]/g,''))+'">Call customer</a>':'')+(r.request_type==='issue'&&r.status==='approved'?'<button class="primary" type="button" data-resolve-request="'+esc(r.id)+'" data-decision="complete">Mark resolved</button>':'<button class="primary" type="button" data-resolve-request="'+esc(r.id)+'" data-decision="approve">'+(r.request_type==='issue'?'Mark reviewed':'Approve')+'</button><button class="ghost" type="button" data-resolve-request="'+esc(r.id)+'" data-decision="reject">'+(r.request_type==='issue'?'Close request':'Reject')+'</button>')+'</div></article>').join('');
 requestRoot.innerHTML='<div class="fw-admin-section-head"><div><span class="eyebrow">CUSTOMER CARE</span><h2>Customer requests</h2><p>Order-related help requests submitted through FreshWay.</p></div><button class="ghost" type="button" data-refresh-requests>Refresh</button></div><p data-request-status class="muted fw-admin-status" role="status" aria-live="polite">'+requests.length+' pending request'+(requests.length===1?'':'s')+'.</p><div class="fw-request-list">'+(cards||'<section class="panel"><h3>No pending requests</h3><p class="muted">New order-related requests will appear here.</p></section>')+'</div><p class="fw-contact-note"><strong>Note:</strong> This list contains order-related requests only. The customer Contact FreshWay page displays contact details; general messages sent there are not saved to an inbox yet.</p>'}
async function loadRequests(){if(!requestRoot||requestBusy)return;requestBusy=true;requestRoot.innerHTML='<p class="muted">Loading customer requests…</p>';try{const d=await api('/admin/delivery/requests');requests=Array.isArray(d.requests)?d.requests:[];renderRequests()}catch(e){requestRoot.innerHTML='<section class="panel"><h2>Could not load requests</h2><p class="muted">'+esc(e.message)+'</p><button class="primary" type="button" data-refresh-requests>Try again</button></section>'}finally{requestBusy=false}}
requestRoot&&requestRoot.addEventListener('click',async e=>{if(e.target.closest('[data-refresh-requests]')){await loadRequests();return}const o=e.target.closest('[data-open-request-order]');if(o){if(window.navigateAdminScreen)window.navigateAdminScreen('orders');const search=document.querySelector('#orderSearch');if(search){search.value=o.dataset.openRequestOrder;search.dispatchEvent(new Event('input',{bubbles:true}))}return}const a=e.target.closest('[data-resolve-request]');if(!a)return;const buttons=a.closest('.fw-request-card')?.querySelectorAll('[data-resolve-request]');buttons?.forEach(b=>b.disabled=true);try{await api('/admin/delivery/requests/'+encodeURIComponent(a.dataset.resolveRequest),{method:'PATCH',body:JSON.stringify({decision:a.dataset.decision})});await loadRequests()}catch(err){note(requestRoot,err.message,'[data-request-status]');buttons?.forEach(b=>b.disabled=false)}});
window.FreshWayOwnerStoreManagement={load:loadStores,refresh:refreshStores,open:openStoreManagement,close:closeStoreManagement,beforeNavigate,historyContext};window.FreshWayOwnerCustomerRequests={load:loadRequests};
})();