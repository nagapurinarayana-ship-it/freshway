(()=>{
  const esc2=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money2=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
  const validCoords=(lat,lon)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Number(lat)>=-90&&Number(lat)<=90&&Number(lon)>=-180&&Number(lon)<=180&&!(Number(lat)===0&&Number(lon)===0);
  const next={New:['Confirmed','Cancelled'],Confirmed:['Processing','Cancelled'],Processing:['Ready','Cancelled'],Ready:['Out for Delivery','Cancelled'],"Out for Delivery":['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
  const label={New:'New',Confirmed:'Confirmed',Processing:'Processing',Ready:'Ready','Out for Delivery':'Out for delivery',Delivered:'Delivered',Cancelled:'Cancelled'};
  const istDay=v=>{if(!v)return'';try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}catch(_){return''}};
  async function getOrder(id){const d=await api(`/admin/orders?search=${encodeURIComponent(id)}&limit=1`);return d.orders?.[0]}
  async function openLifecycle(id){
    try{
      const o=await getOrder(id); if(!o)return;
      const choices=next[o.status]||[];
      const actionButtons=choices.map(s=>`<button class="${s==='Cancelled'?'danger':'primary'}" data-life-action="${esc2(s)}">${s==='Cancelled'?'Cancel order':`Mark ${esc2(label[s])}`}</button>`).join('');
      const payment=o.status==='Delivered'&&String(o.payment).toLowerCase()!=='collected'?'<button class="primary" data-life-payment="Collected">Mark cash collected</button>':'';
      const hasCoords=validCoords(o.address?.latitude,o.address?.longitude);
      const mapTarget=hasCoords?`${o.address.latitude},${o.address.longitude}`:[o.address?.house,o.address?.area,o.address?.locality,o.address?.city,o.address?.district,o.address?.state,o.address?.pincode].filter(Boolean).join(', ');
      $('#modalBody').innerHTML=`<span class="eyebrow">ORDER LIFECYCLE</span><h2>${esc2(o.id)}</h2><div class="detail-grid"><div><small>Status</small><b>${esc2(label[o.status]||o.status)}</b></div><div><small>Payment</small><b>${esc2(o.payment)}</b></div><div><small>Delivery</small><b>${esc2(o.deliveryPlan)}</b></div><div><small>Total</small><b>${money2(o.total)}</b></div></div><h3>Customer</h3><p><b>${esc2(o.customer?.name||'')}</b><br>📞 ${esc2(o.customer?.phone||'')}<br>📍 ${esc2([o.address?.house,o.address?.area,o.address?.locality,o.address?.city,o.address?.district,o.address?.state,o.address?.pincode].filter(Boolean).join(', '))}</p><h3>Items</h3><div class="detail-items">${(o.items||[]).map(i=>`<div><span>${esc2(i.name)} ×${i.qty} ${esc2(i.unit)}</span><b>${money2(i.lineTotal)}</b></div>`).join('')}</div><div class="detail-actions">${actionButtons}${payment}${mapTarget?`<button class="ghost" data-life-map="${encodeURIComponent(mapTarget)}">${hasCoords?'Open exact location in Maps':'Open written address in Maps'}</button>`:''}</div>`;
      $('#modal').classList.remove('hidden');
      $$('[data-life-action]').forEach(b=>b.onclick=async()=>{const status=b.dataset.lifeAction;if(status==='Cancelled'&&!confirm('Cancel this order?'))return;await change(o.id,{status})});
      $$('[data-life-payment]').forEach(b=>b.onclick=async()=>change(o.id,{payment:b.dataset.lifePayment}));
      $$('[data-life-map]').forEach(b=>b.onclick=()=>{const target=decodeURIComponent(b.dataset.lifeMap);const url=hasCoords?`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;const w=window.open(url,'_blank','noopener,noreferrer');if(!w)window.location.href=url});
    }catch(e){toast(e.message)}
  }
  async function change(id,patch){try{await api(`/admin/orders/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)});toast('Order updated');$('#modal').classList.add('hidden');await loadSummary();if(typeof loadOrders==='function')await loadOrders(true);if(typeof loadHome==='function')await loadHome();if(document.getElementById('cash')?.classList.contains('active'))await enhanceCash(true);}catch(e){toast(e.message)}}
  async function enhanceCash(force=false){
    const root=document.getElementById('cashSummary');
    if(!root||(!force&&root.dataset.cashEnhanced==='1'))return;
    try{
      const r=await api('/admin/reports?range=today');
      const d=await api('/admin/orders?page=1&limit=50&payment=Collected&sort=newest');
      const today=istDay(new Date());
      const collected=(d.orders||[]).filter(o=>o.status!=='Cancelled'&&istDay(o.paymentCollectedAt||o.updatedAt||o.createdAt)===today);
      const collectedTotal=collected.reduce((sum,o)=>sum+Number(o.total||0),0);
      const collectedOrders=collected.length;
      root.dataset.cashEnhanced='1';
      root.innerHTML=`<div class="cash-summary-grid"><article class="report"><span>Cash pending</span><strong>${money2(r.cashPending)}</strong><small>${r.cashPendingOrders} orders still outstanding</small></article><article class="report"><span>Cash collected</span><strong>${money2(collectedTotal)}</strong><small>${collectedOrders} collections today</small></article></div><div class="cash-collected-total"><span>Collected today</span><strong>${money2(collectedTotal)}</strong></div>`;
      const list=document.getElementById('cashList');
      if(list){list.innerHTML=collected.length?`<div class="section-head"><div><span class="eyebrow">COLLECTED</span><h2>Cash collected today</h2><p>${collectedOrders} orders · ${money2(collectedTotal)} total</p></div></div>`+collected.map(orderCardForCash).join(''):'<div class="empty">No cash collected today.</div>'}
    }catch(e){root.dataset.cashEnhanced='';toast(e.message)}
  }
  function orderCardForCash(o){return `<article class="card order-card" data-order="${esc2(o.id)}"><div class="card-top"><div><b>${esc2(o.id)}</b><small>${esc2(new Date(o.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}</small></div><span class="badge Delivered">Delivered</span></div><div class="person"><div><b>${esc2(o.customer?.name||'Customer')}</b><small>📞 ${esc2(o.customer?.phone||'')}</small></div><strong>${money2(o.total)}</strong></div><div class="meta">${(o.items||[]).slice(0,3).map(i=>`${esc2(i.name)} ×${i.qty}`).join(' · ')}${(o.items||[]).length>3?' · +more':''}</div><div class="card-foot"><span>🚚 ${esc2(o.deliveryPlan||'Unscheduled')}</span><span class="pay good">💵 Collected</span></div></article>`}
  const baseLoadCash=window.loadCash;
  if(typeof baseLoadCash==='function'){
    window.loadCash=async function(){await baseLoadCash();await enhanceCash(true)};
  }
  document.addEventListener('click',e=>{const card=e.target.closest('[data-order]');if(!card)return;e.preventDefault();e.stopImmediatePropagation();openLifecycle(card.dataset.order)},true);
  document.addEventListener('DOMContentLoaded',()=>{
    const sel=document.getElementById('orderStatus');if(sel){sel.innerHTML='<option value="all">All status</option><option value="New">New</option><option value="Confirmed">Confirmed</option><option value="Processing">Processing</option><option value="Ready">Ready</option><option value="Out for Delivery">Out for delivery</option><option value="Delivered">Delivered</option><option value="Cancelled">Cancelled</option>'}
    const cash=document.getElementById('cash');
    if(cash){const observer=new MutationObserver(()=>{if(cash.classList.contains('active')){const root=document.getElementById('cashSummary');if(root)root.dataset.cashEnhanced='';enhanceCash()}});observer.observe(cash,{attributes:true,subtree:true,attributeFilter:['class']});}
    if(location.hash==='#cash')enhanceCash(true);
  });
  if(!document.querySelector('script[src*="frontend/admin/catalogue.js"]')){const s=document.createElement('script');s.src='frontend/admin/catalogue.js?v=20260908-catalogue-v1';document.body.appendChild(s)}
})();
