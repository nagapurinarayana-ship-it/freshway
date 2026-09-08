(()=>{
  const esc2=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money2=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
  const validCoords=(lat,lon)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Number(lat)>=-90&&Number(lat)<=90&&!(Number(lat)===0&&Number(lon)===0)&&Number(lon)>=-180&&Number(lon)<=180;
  const next={New:['Confirmed','Cancelled'],Confirmed:['Processing','Cancelled'],Processing:['Ready','Cancelled'],Ready:['Out for Delivery','Cancelled'],"Out for Delivery":['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
  const label={New:'New',Confirmed:'Confirmed',Processing:'Processing',Ready:'Ready','Out for Delivery':'Out for delivery',Delivered:'Delivered',Cancelled:'Cancelled'};
  const istDay=v=>{if(!v)return'';try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}catch(_){return''}};
  async function getOrder(id){const d=await api(`/admin/orders?search=${encodeURIComponent(id)}&limit=1`);return d.orders?.[0]}
  async function openLifecycle(id){try{const o=await getOrder(id);if(!o)return;const choices=next[o.status]||[];const actionButtons=choices.map(s=>`<button class="${s==='Cancelled'?'danger':'primary'}" data-life-action="${esc2(s)}">${s==='Cancelled'?'Cancel order':`Mark ${esc2(label[s])}`}</button>`).join('');const payment=o.status==='Delivered'&&String(o.payment).toLowerCase()!=='collected'?'<button class="primary" data-life-payment="Collected">Mark cash collected</button>':'';const hasCoords=validCoords(o.address?.latitude,o.address?.longitude);const mapTarget=hasCoords?`${o.address.latitude},${o.address.longitude}`:[o.address?.house,o.address?.area,o.address?.locality,o.address?.city,o.address?.district,o.address?.state,o.address?.pincode].filter(Boolean).join(', ');$('#modalBody').innerHTML=`<span class="eyebrow">ORDER LIFECYCLE</span><h2>${esc2(o.id)}</h2><div class="detail-grid"><div><small>Status</small><b>${esc2(label[o.status]||o.status)}</b></div><div><small>Payment</small><b>${esc2(o.payment)}</b></div><div><small>Delivery</small><b>${esc2(o.deliveryPlan)}</b></div><div><small>Total</small><b>${money2(o.total)}</b></div></div><h3>Customer</h3><p><b>${esc2(o.customer?.name||'')}</b><br>📞 ${esc2(o.customer?.phone||'')}<br>📍 ${esc2([o.address?.house,o.address?.area,o.address?.locality,o.address?.city,o.address?.district,o.address?.state,o.address?.pincode].filter(Boolean).join(', '))}</p><h3>Items</h3><div class="detail-items">${(o.items||[]).map(i=>`<div><span>${esc2(i.name)} ×${i.qty} ${esc2(i.unit)}</span><b>${money2(i.lineTotal)}</b></div>`).join('')}</div><div class="detail-actions">${actionButtons}${payment}${mapTarget?`<button class="ghost" data-life-map="${encodeURIComponent(mapTarget)}">${hasCoords?'Open exact location in Maps':'Open written address in Maps'}</button>`:''}</div>`;$('#modal').classList.remove('hidden');$$('[data-life-action]').forEach(b=>b.onclick=async()=>{const status=b.dataset.lifeAction;if(status==='Cancelled'&&!confirm('Cancel this order?'))return;await change(o.id,{status})});$$('[data-life-payment]').forEach(b=>b.onclick=async()=>change(o.id,{payment:b.dataset.lifePayment}));$$('[data-life-map]').forEach(b=>b.onclick=()=>{const target=decodeURIComponent(b.dataset.lifeMap);const url=hasCoords?`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;const w=window.open(url,'_blank','noopener,noreferrer');if(!w)window.location.href=url})}catch(e){toast(e.message)}}
  async function change(id,patch){try{await api(`/admin/orders/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)});toast('Order updated');$('#modal').classList.add('hidden');await loadSummary();if(typeof loadOrders==='function')await loadOrders(true);if(typeof loadHome==='function')await loadHome();if(document.getElementById('cash')?.classList.contains('active'))await enhanceCash(true)}catch(e){toast(e.message)}}
  async function fetchAllCashOrders(payment){let page=1,all=[];for(let guard=0;guard<100;guard++){const d=await api(`/admin/orders?page=${page}&limit=50&payment=${encodeURIComponent(payment)}&sort=newest`);const rows=Array.isArray(d.orders)?d.orders:[];all.push(...rows);const total=Number(d.pagination?.total||0);if(!rows.length||!d.pagination||all.length>=total)break;page++}return all}
  async function enhanceCash(force=false){const root=document.getElementById('cashSummary');if(!root||(!force&&root.dataset.cashEnhanced==='1'))return;try{const r=await api('/admin/reports?range=today');const pending=(await fetchAllCashOrders('Pending')).filter(o=>o.status!=='Cancelled');const collected=await fetchAllCashOrders('Collected');const today=istDay(new Date());const collectedToday=collected.filter(o=>o.status!=='Cancelled'&&istDay(o.paymentCollectedAt||o.updatedAt||o.createdAt)===today);const pendingTotal=pending.reduce((sum,o)=>sum+Number(o.total||0),0);const collectedTotal=collectedToday.reduce((sum,o)=>sum+Number(o.total||0),0);const collectedOrders=collectedToday.length;root.dataset.cashEnhanced='1';root.innerHTML=`<div class="cash-summary-grid"><article class="report"><span>Cash pending</span><strong>${money2(pendingTotal)}</strong><small>${pending.length} orders still outstanding</small></article><article class="report"><span>Cash collected</span><strong>${money2(collectedTotal)}</strong><small>${collectedOrders} collections today</small></article></div><div class="cash-collected-total"><span>Collected today</span><strong>${money2(collectedTotal)}</strong></div>`;const list=document.getElementById('cashList');if(list){list.innerHTML=pending.length?`<div class="section-head"><div><span class="eyebrow">PENDING CASH</span><h2>Cash not collected</h2><p>${pending.length} orders · ${money2(pendingTotal)} outstanding</p></div></div>`+pending.map(orderCard).join(''):'<div class="empty">All clear — no cash orders are pending.</div>'}}catch(e){root.dataset.cashEnhanced='';toast(e.message)}}
  const baseLoadCash=window.loadCash;if(typeof baseLoadCash==='function')window.loadCash=async function(){await baseLoadCash();await enhanceCash(true)};
  document.addEventListener('click',e=>{const card=e.target.closest('[data-order]');if(!card)return;e.preventDefault();e.stopImmediatePropagation();openLifecycle(card.dataset.order)},true);
  document.addEventListener('DOMContentLoaded',()=>{const sel=document.getElementById('orderStatus');if(sel)sel.innerHTML='<option value="all">All status</option><option value="New">New</option><option value="Confirmed">Confirmed</option><option value="Processing">Processing</option><option value="Ready">Ready</option><option value="Out for Delivery">Out for delivery</option><option value="Delivered">Delivered</option><option value="Cancelled">Cancelled</option>';const cash=document.getElementById('cash');if(cash){const observer=new MutationObserver(()=>{if(cash.classList.contains('active')){const root=document.getElementById('cashSummary');if(root)root.dataset.cashEnhanced='';enhanceCash()}});observer.observe(cash,{attributes:true,subtree:true,attributeFilter:['class']})}if(location.hash==='#cash')enhanceCash(true)});
  if(!document.querySelector('script[src*="frontend/admin/catalogue.js"]')){const s=document.createElement('script');s.src='frontend/admin/catalogue.js?v=20260908-catalogue-v1';document.body.appendChild(s)}
  const previousNavigate=window.navigateAdminScreen;
  if(typeof previousNavigate==='function'){
    window.navigateAdminScreen=function(id){
      if(id==='catalogue'){
        document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));
        document.querySelectorAll('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===id));
        history.replaceState(null,'',`#${id}`);
        window.scrollTo({top:0,behavior:'auto'});
        if(typeof window.freshWayCatalogueRefresh==='function')return window.freshWayCatalogueRefresh();
        return;
      }
      return previousNavigate(id);
    };
  }
  const ownerRefresh=async()=>{
    const button=document.getElementById('refreshBtn');
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
    try{
      const id=location.hash.slice(1)||'overview';
      if(id==='overview')await Promise.all([loadSummary(),loadBusiness(),loadHome()]);
      else if(id==='orders')await loadOrders(true);
      else if(id==='delivery')await loadDelivery(true);
      else if(id==='cash')await loadCash();
      else if(id==='customers')await loadCustomers(true);
      else if(id==='catalogue'){
        if(typeof window.freshWayCatalogueRefresh==='function')await window.freshWayCatalogueRefresh();
        else{const d=await api('/admin/products');products=d.products||[];renderProducts();}
      }else if(id==='notifications')await loadHistory();
      else if(id==='reports')await loadReports();
    }catch(e){toast(e.message||'Refresh failed')}
    finally{const b=document.getElementById('refreshBtn');if(b){b.disabled=false;b.removeAttribute('aria-busy')}}
  };
  window.freshWayOwnerRefresh=ownerRefresh;
  const removeDuplicateRefreshControls=()=>{
    document.getElementById('refreshHistory')?.remove();
    document.getElementById('fwRefreshCatalogue')?.remove();
    const b=document.getElementById('refreshBtn');
    if(!b)return;
    b.type='button';
    b.onclick=ownerRefresh;
  };
  removeDuplicateRefreshControls();
  document.addEventListener('DOMContentLoaded',removeDuplicateRefreshControls,{once:true});
  if(document.body)new MutationObserver(removeDuplicateRefreshControls).observe(document.body,{childList:true,subtree:true});
})();