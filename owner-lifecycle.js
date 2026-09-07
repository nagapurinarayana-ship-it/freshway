(()=>{
  const esc2=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money2=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
  const next={New:['Confirmed','Cancelled'],Confirmed:['Processing','Cancelled'],Processing:['Ready','Cancelled'],Ready:['Out for Delivery','Cancelled'],"Out for Delivery":['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
  const label={New:'New',Confirmed:'Confirmed',Processing:'Processing',Ready:'Ready','Out for Delivery':'Out for delivery',Delivered:'Delivered',Cancelled:'Cancelled'};
  async function getOrder(id){const d=await api(`/admin/orders?search=${encodeURIComponent(id)}&limit=1`);return d.orders?.[0]}
  async function openLifecycle(id){
    try{
      const o=await getOrder(id); if(!o)return;
      const choices=next[o.status]||[];
      const actionButtons=choices.map(s=>`<button class="${s==='Cancelled'?'danger':'primary'}" data-life-action="${esc2(s)}">${s==='Cancelled'?'Cancel order':`Mark ${esc2(label[s])}`}</button>`).join('');
      const payment=o.status==='Delivered'&&String(o.payment).toLowerCase()!=='collected'?'<button class="primary" data-life-payment="Collected">Mark cash collected</button>':'';
      $('#modalBody').innerHTML=`<span class="eyebrow">ORDER LIFECYCLE</span><h2>${esc2(o.id)}</h2><div class="detail-grid"><div><small>Status</small><b>${esc2(label[o.status]||o.status)}</b></div><div><small>Payment</small><b>${esc2(o.payment)}</b></div><div><small>Delivery</small><b>${esc2(o.deliveryPlan)}</b></div><div><small>Total</small><b>${money2(o.total)}</b></div></div><h3>Customer</h3><p><b>${esc2(o.customer?.name||'')}</b><br>📞 ${esc2(o.customer?.phone||'')}<br>📍 ${esc2([o.address?.house,o.address?.area,o.address?.city,o.address?.pincode].filter(Boolean).join(', '))}</p><h3>Items</h3><div class="detail-items">${(o.items||[]).map(i=>`<div><span>${esc2(i.name)} ×${i.qty} ${esc2(i.unit)}</span><b>${money2(i.lineTotal)}</b></div>`).join('')}</div><div class="detail-actions">${actionButtons}${payment}<button class="ghost" data-life-map="${encodeURIComponent([o.address?.house,o.address?.area,o.address?.city,o.address?.pincode].filter(Boolean).join(', '))}">Open map</button></div>`;
      $('#modal').classList.remove('hidden');
      $$('[data-life-action]').forEach(b=>b.onclick=async()=>{const status=b.dataset.lifeAction;if(status==='Cancelled'&&!confirm('Cancel this order?'))return;await change(o.id,{status})});
      $$('[data-life-payment]').forEach(b=>b.onclick=async()=>change(o.id,{payment:b.dataset.lifePayment}));
      $$('[data-life-map]').forEach(b=>b.onclick=()=>window.open(`https://www.google.com/maps/search/?api=1&query=${b.dataset.lifeMap}`,'_blank'));
    }catch(e){toast(e.message)}
  }
  async function change(id,patch){try{await api(`/admin/orders/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)});toast('Order updated');$('#modal').classList.add('hidden');await loadSummary();if(typeof loadOrders==='function')await loadOrders(true);if(typeof loadHome==='function')await loadHome();}catch(e){toast(e.message)}}
  document.addEventListener('click',e=>{const card=e.target.closest('[data-order]');if(!card)return;e.preventDefault();e.stopImmediatePropagation();openLifecycle(card.dataset.order)},true);
  document.addEventListener('DOMContentLoaded',()=>{
    const sel=document.getElementById('orderStatus');if(sel){sel.innerHTML='<option value="all">All status</option><option value="New">New</option><option value="Confirmed">Confirmed</option><option value="Processing">Processing</option><option value="Ready">Ready</option><option value="Out for Delivery">Out for delivery</option><option value="Delivered">Delivered</option><option value="Cancelled">Cancelled</option>'}
  });
})();