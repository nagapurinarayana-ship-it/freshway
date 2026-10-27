// Customer order-list rendering. All state-changing actions are delegated to order-actions.js.
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
    if(o.invoice?.number)return '<div class="invoice-actions"><button type="button" class="secondary-btn full invoice-download-btn" data-download-invoice="'+esc(o.id)+'"><span aria-hidden="true">↓</span> Download invoice (PDF)<small>Invoice '+esc(o.invoice.number)+'</small></button></div>';
    const status=String(o.status||'').trim().toLowerCase();
    if(status==='cancelled'||status==='canceled')return '<p class="muted invoice-pending">No invoice was issued for this cancelled order.</p>';
    if(status==='delivered'||status==='out for delivery'||status==='dispatched')return '<p class="muted invoice-pending">No invoice is available for download yet. Contact FreshWay if you need help with a dispatched order.</p>';
    return '<p class="muted invoice-pending">Your order is awaiting dispatch. The invoice PDF will be available here after dispatch.</p>';
  };
  const indiaDate=value=>{
    if(!value)return '';
    const raw=String(value),date=new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)?raw:raw.replace(' ','T')+'Z');
    if(Number.isNaN(date.getTime()))return raw.slice(0,10);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),values={};
    parts.forEach(part=>values[part.type]=part.value);
    return values.year+'-'+values.month+'-'+values.day;
  };
  const scheduleText=o=>{
    const orderStatus=String(o.status||'').trim().toLowerCase();
    if(orderStatus==='cancelled'||orderStatus==='canceled')return '';
    if(orderStatus==='delivered'){
      const deliveredDate=indiaDate(o.deliveredAt);
      return deliveredDate?'Delivered on '+deliveredDate:'Delivered';
    }
    if(!o.scheduledDelivery?.date)return '';
    const date=String(o.scheduledDelivery.date),start=String(o.scheduledDelivery.startTime||''),end=String(o.scheduledDelivery.endTime||'');
    return 'Delivery date: '+date+(start&&end?' · '+start+'–'+end:'');
  };
  const actions=(o,esc)=>{
    const id=esc(o.id),status=String(o.status||'').toLowerCase();
    const delivered=status==='delivered',cancelled=status==='cancelled'||status==='canceled';
    let html='<div class="fw-customer-order-actions">';
    if(!delivered&&!cancelled){
      html+='<button type="button" class="secondary-btn" data-customer-order-cancel="'+id+'">Cancel order</button>';
      if(o.scheduledDelivery?.date)html+='<button type="button" class="secondary-btn" data-customer-order-reschedule="'+id+'" aria-expanded="false">Change delivery date</button>';
      html+='<button type="button" class="text-btn" data-customer-order-open-request="issue">Contact FreshWay</button>';
    }else if(delivered){
      html+='<button type="button" class="secondary-btn" data-customer-order-open-request="issue">Report an issue</button><button type="button" class="secondary-btn" data-customer-order-open-request="return">Request a return</button>';
    }else{
      html+='<button type="button" class="text-btn" data-customer-order-open-request="issue">Need help with this order?</button>';
    }
    html+='</div><div class="fw-customer-request-panel" data-customer-order-request-panel hidden><strong data-customer-request-heading>Contact FreshWay about this order</strong><textarea rows="3" maxlength="500" placeholder="Describe your request (optional)"></textarea><div class="fw-customer-order-actions"><button type="button" class="primary-btn" data-customer-order-submit-request>Send request</button><button type="button" class="secondary-btn" data-customer-order-close-request>Keep shopping</button></div></div>';
    if(!delivered&&!cancelled&&o.scheduledDelivery?.date)html+='<div class="fw-customer-reschedule" data-customer-reschedule-picker hidden></div>';
    return html;
  };
  const render=(document,list,{esc,formatDate,money,statusLabel,planText})=>{
    const el=document.querySelector('#customerOrders');
    if(!el)return;
    if(!list.length){el.innerHTML='<div class="empty"><div style="font-size:38px">📦</div><strong>No orders yet</strong><br>Your placed orders will appear here.</div>';return}
    el.innerHTML=list.map(o=>{
      const lines=(o.items||[]).map(i=>'<div class="order-line"><span>'+esc(i.name)+' · '+i.qty+' '+esc(i.unit)+'</span><strong>'+money(i.lineTotal??i.price*i.qty)+'</strong></div>').join('');
      const address=o.address||{};
      const status=String(o.status||'').toLowerCase().replace(/\s+/g,'-');
      return '<article class="order-card" data-order-id="'+esc(o.id)+'"><div class="order-head"><strong>'+esc(o.id)+'</strong><span class="status '+status+'">'+esc(statusLabel(o.status))+'</span></div><div class="order-date">'+esc(formatDate(o.createdAt))+'</div><div class="order-items">'+lines+'</div><div class="order-total"><span>Total</span><span>'+money(o.total)+'</span></div><div class="address-block">📍 '+esc(address.house||'')+', '+esc(address.area||'')+', '+esc(address.city||'')+' - '+esc(address.pincode||'')+(address.landmark?'<br>Landmark: '+esc(address.landmark):'')+(address.note?'<br>Note: '+esc(address.note):'')+'</div><div class="fw-customer-schedule-copy"><span class="product-meta" style="margin:0">🚚 Delivery</span><strong>'+esc(deliveryText(o.status,o.deliveryPlan,planText))+'</strong><p>'+esc(scheduleText(o))+'</p></div><div class="status-row"><span class="product-meta" style="margin:0">💵 Cash payment</span><span class="status '+(o.payment==='Collected'?'delivered':'ordered')+'">'+esc(o.payment||'Pending')+'</span></div>'+actions(o,esc)+invoiceAction(o,esc)+'</article>';
    }).join('');
  };
  window.FreshWayCustomerOrdersView=Object.freeze({render});
})();