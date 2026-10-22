// Customer orders-view boundary.
// Owns only customer order-list DOM rendering; data loading and navigation stay in app.js.
(function(){
  const terminalStatus=status=>{
    const value=String(status||'').trim().toLowerCase();
    if(value==='delivered')return 'Delivered';
    if(value==='cancelled'||value==='canceled')return 'Cancelled';
    return '';
  };
  const deliveryText=(status,planValue,planText)=>terminalStatus(status)||planText(planValue);
  const deliveryClass=status=>terminalStatus(status).toLowerCase()||'ordered';
  const invoiceAction=(o,esc)=>{
    if(o.invoice?.number){
      return `<div class="invoice-actions"><button type="button" class="secondary-btn full invoice-download-btn" data-download-invoice="${esc(o.id)}"><span aria-hidden="true">↓</span> Download invoice (PDF)<small>Invoice ${esc(o.invoice.number)}</small></button></div>`;
    }
    const status=String(o.status||'').trim().toLowerCase();
    if(status==='cancelled'||status==='canceled')return '<p class="muted invoice-pending">No invoice was issued for this cancelled order.</p>';
    if(status==='delivered'||status==='out for delivery')return '<p class="muted invoice-pending">This historical order has no issued invoice available to download.</p>';
    return '<p class="muted invoice-pending">Invoice PDF will appear here once invoice issuance is enabled and your order is dispatched.</p>';
  };
  const render=(document,list,{esc,formatDate,money,statusLabel,planText})=>{
    const el=document.querySelector('#customerOrders');
    if(!el)return;
    if(!list.length){el.innerHTML='<div class="empty"><div style="font-size:38px">📦</div><strong>No orders yet</strong><br>Your placed orders will appear here.</div>';return}
    el.innerHTML=list.map(o=>`<article class="order-card" data-order-id="${esc(o.id)}"><div class="order-head"><strong>${esc(o.id)}</strong><span class="status ${String(o.status||'').toLowerCase().replaceAll(' ','-')}">${esc(statusLabel(o.status))}</span></div><div class="order-date">${esc(formatDate(o.createdAt))}</div><div class="order-items">${(o.items||[]).map(i=>`<div class="order-line"><span>${esc(i.name)} · ${i.qty} ${esc(i.unit)}</span><strong>${money(i.lineTotal??i.price*i.qty)}</strong></div>`).join('')}</div><div class="order-total"><span>Total</span><span>${money(o.total)}</span></div><div class="address-block">📍 ${esc(o.address?.house||'')}, ${esc(o.address?.area||'')}, ${esc(o.address?.city||'')} - ${esc(o.address?.pincode||'')}${o.address?.landmark?`<br>Landmark: ${esc(o.address.landmark)}`:''}${o.address?.note?`<br>Note: ${esc(o.address.note)}`:''}</div><div class="status-row"><span class="product-meta" style="margin:0">🚚 Delivery</span><span class="status ${deliveryClass(o.status)}">${esc(deliveryText(o.status,o.deliveryPlan,planText))}</span></div><div class="status-row"><span class="product-meta" style="margin:0">💵 Cash payment</span><span class="status ${o.payment==='Collected'?'delivered':'ordered'}">${esc(o.payment||'Pending')}</span></div>${invoiceAction(o,esc)}</article>`).join('');
  };
  window.FreshWayCustomerOrdersView=Object.freeze({render});
})();
