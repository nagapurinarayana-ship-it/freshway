(()=>{
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
  const next={New:['Confirmed','Cancelled'],Confirmed:['Processing','Cancelled'],Processing:['Ready','Cancelled'],Ready:['Out for Delivery','Cancelled'],'Out for Delivery':['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
  const paymentNext={'Not Collected':['Collected'],Collected:['Refunded'],Refunded:[],Cancelled:[]};
  const statusLabel={'Out for Delivery':'Out for delivery'};
  const paymentLabel={'Not Collected':'Not collected'};
  let id='',order=null,busy=false,queue=Promise.resolve();

  async function getOrder(orderId){const d=await api(`/admin/orders?search=${encodeURIComponent(orderId)}&limit=1`);return d.orders?.[0]}
  const serial=job=>{const run=queue.then(job,job);queue=run.catch(()=>{});return run};
  const optionList=(current,values,labels)=>[current,...values].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option value="${esc(v)}">${esc(labels[v]||v)}</option>`).join('');

  function render(o){
    if(!o||o.id!==id)return;
    order=o;
    const a=o.address||{};
    const choices=next[o.status]||[];
    const paymentChoices=o.status==='Delivered'?(paymentNext[o.payment]||[]):o.status==='Cancelled'&&o.payment==='Not Collected'?['Cancelled']:[];
    const mapTarget=[a.house,a.area,a.locality,a.city,a.district,a.state,a.pincode].filter(Boolean).join(', ');
    const actions=choices.map(s=>`<button type="button" class="${s==='Cancelled'?'danger':'primary'}" data-fw-life-action="${esc(s)}">${s==='Cancelled'?'Cancel order':`Mark ${esc(statusLabel[s]||s)}`}</button>`).join('');
    $('#modalBody').innerHTML=`<span class="eyebrow">ORDER LIFECYCLE</span><h2>${esc(o.id)}</h2><div class="detail-grid lifecycle-fields"><label><small>Status</small><select id="fwLifeStatus">${optionList(o.status,choices,statusLabel)}</select></label><label><small>Payment</small><select id="fwLifePayment">${optionList(o.payment,paymentChoices,paymentLabel)}</select></label><div><small>Delivery</small><b>${esc(o.deliveryPlan||'Unscheduled')}</b></div><div><small>Total</small><b>${money(o.total)}</b></div></div><p class="lifecycle-autosave">Auto-saved immediately. You can update status and payment without closing this window.</p><h3>Customer</h3><p><b>${esc(o.customer?.name||'')}</b><br>📞 ${esc(o.customer?.phone||'')}<br>📍 ${esc([a.house,a.area,a.locality,a.city,a.district,a.state,a.pincode].filter(Boolean).join(', '))}${a.landmark?`<br>Landmark: ${esc(a.landmark)}`:''}${a.note?`<br>Instructions: ${esc(a.note)}`:''}</p><h3>Items</h3><div class="detail-items">${(o.items||[]).map(i=>`<div><span>${esc(i.name)} ×${i.qty} ${esc(i.unit)}</span><b>${money(i.lineTotal)}</b></div>`).join('')}</div><div class="detail-actions">${actions}${mapTarget?`<button type="button" class="ghost" data-fw-life-map="${encodeURIComponent(mapTarget)}">Open written address in Maps</button>`:''}</div>`;
    $('#modal').classList.remove('hidden');
    $('#fwLifeStatus').value=o.status;
    $('#fwLifePayment').value=o.payment;
    $('#fwLifeStatus').onchange=e=>save('status',e.target.value);
    $('#fwLifePayment').onchange=e=>save('payment',e.target.value);
    $$('[data-fw-life-action]').forEach(b=>b.onclick=async()=>{const v=b.dataset.fwLifeAction;if(v==='Cancelled'&&!confirm('Cancel this order?'))return;await save('status',v)});
    $$('[data-fw-life-map]').forEach(b=>b.onclick=()=>window.open(`https://www.google.com/maps/search/?api=1&query=${b.dataset.fwLifeMap}`,'_blank','noopener,noreferrer'));
  }

  async function save(field,value){
    const orderId=id;
    if(!order||orderId!==id||order[field]===value)return;
    return serial(async()=>{
      if(orderId!==id||!order)return;
      const previous=order;
      busy=true;
      const statusEl=$('#fwLifeStatus'),paymentEl=$('#fwLifePayment');
      if(statusEl)statusEl.disabled=true;if(paymentEl)paymentEl.disabled=true;
      try{
        await api(`/admin/orders/${encodeURIComponent(orderId)}`,{method:'PATCH',body:JSON.stringify({[field]:value})});
        const fresh=await getOrder(orderId);
        if(!fresh)throw Error('Order could not be reloaded after update.');
        const idx=orders.findIndex(x=>x.id===orderId);if(idx>=0)orders[idx]=fresh;
        order=fresh;
        toast(field==='status'?'Order status saved':'Payment status saved');
        render(fresh);
        refreshLists();
      }catch(e){
        order=previous;
        render(previous);
        toast(e.message);
        throw e;
      }finally{busy=false}
    });
  }

  async function refreshLists(){
    try{await loadSummary();if(typeof loadOrders==='function')await loadOrders(true);if(typeof loadHome==='function')await loadHome()}catch(e){toast(e.message)}
  }

  async function open(orderId){
    try{ id=orderId;busy=false; const o=await getOrder(orderId); if(!o){toast('Order not found');return} order=o; render(o); }
    catch(e){toast(e.message)}
  }

  // Register before owner-lifecycle.js so this persistent modal owns order-card clicks.
  document.addEventListener('click',e=>{
    const card=e.target.closest('[data-order]');
    if(!card)return;
    e.preventDefault();e.stopImmediatePropagation();open(card.dataset.order);
  },true);
})();