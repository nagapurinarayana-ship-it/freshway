(function(){
  const statusClass=s=>String(s||'').toLowerCase().replace(/\s+/g,'-');
  const itemCount=o=>(o.items||[]).reduce((n,i)=>n+Number(i.qty||0),0);
  const itemWord=n=>n===1?'item':'items';
  const itemThumbs=o=>{
    const items=o.items||[];
    const visible=items.slice(0,4).map(i=>`<span class="order-thumb" title="${esc(i.name)}">${esc(i.emoji||'🛒')}</span>`).join('');
    const more=items.length>4?`<span class="order-thumb more">+${items.length-4}</span>`:'';
    return `<div class="order-thumbs">${visible}${more}</div>`;
  };
  const deliveryText=o=>o.status==='Delivered'?'Delivered':`Delivery: ${planText(o.deliveryPlan)}`;
  const paymentText=o=>o.payment==='Collected'?'Cash collected':'Cash on delivery';
  const addressText=o=>{const a=o.address||{};return [a.house,a.area,a.city].filter(Boolean).join(', ')+(a.pincode?` - ${a.pincode}`:'')};

  function renderOrders(list=state.orders){
    const el=$('#customerOrders');
    if(!el)return;
    if(!list.length){
      el.innerHTML='<div class="empty"><div style="font-size:38px">📦</div><strong>No orders yet</strong><br>Your placed orders will appear here.</div>';
      return;
    }
    el.innerHTML=`<div class="order-filter-row" role="tablist" aria-label="Order status"><button class="order-filter active" data-order-filter="All">All</button><button class="order-filter" data-order-filter="Ordered">Ordered</button><button class="order-filter" data-order-filter="Processing">Processing</button><button class="order-filter" data-order-filter="Out for Delivery">Out for Delivery</button><button class="order-filter" data-order-filter="Delivered">Delivered</button><button class="order-filter" data-order-filter="Cancelled">Cancelled</button></div><div id="orderCards">${list.map(o=>`<article class="order-card order-summary-card" data-order-id="${esc(o.id)}" tabindex="0" role="button" aria-label="Open order ${esc(o.id)}"><div class="order-head"><div><strong>${esc(o.id)}</strong><div class="order-date">${esc(formatDate(o.createdAt))}</div></div><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></div>${itemThumbs(o)}<div class="order-summary-line"><strong>${itemCount(o)} ${itemWord(itemCount(o))}</strong><strong>${money(o.total)}</strong></div><div class="order-summary-meta"><span>🚚 ${esc(deliveryText(o))}</span><span>💵 ${esc(paymentText(o))}</span></div><div class="order-open-row"><span>View order details</span><b>›</b></div></article>`).join('')}</div>`;
    installOrderFilters();
  }

  function installOrderFilters(){
    $$('.order-filter').forEach(btn=>btn.onclick=()=>{
      $$('.order-filter').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      const value=btn.dataset.orderFilter;
      $$('#orderCards .order-summary-card').forEach(card=>{
        const order=state.orders.find(o=>o.id===card.dataset.orderId);
        card.style.display=(!order||value==='All'||order.status===value)?'':'none';
      });
    });
  }

  function statusStep(status){
    if(status==='Cancelled')return -1;
    if(status==='Delivered')return 3;
    if(status==='Out for Delivery')return 2;
    if(status==='Processing')return 1;
    return 0;
  }

  function openOrderDetails(id){
    const order=state.orders.find(o=>o.id===id);
    if(!order){toast('Order details are not available on this device.');return;}
    let view=$('#orderDetailsView');
    if(!view){
      view=document.createElement('section');
      view.id='orderDetailsView';
      view.className='view';
      document.querySelector('main')?.appendChild(view);
    }
    const step=statusStep(order.status);
    const steps=[['Ordered',0],['Preparing',1],['Out for Delivery',2],['Delivered',3]];
    const progress=order.status==='Cancelled'?'<div class="order-cancelled">✕ This order was cancelled.</div>':`<div class="order-progress">${steps.map(([label,n],idx)=>`<div class="progress-step ${n<=step?'done':''} ${n===step?'current':''}"><span>${n<=step?'✓':idx+1}</span><small>${label}</small></div>`).join('')}</div>`;
    const a=order.address||{};
    const items=order.items||[];
    view.innerHTML=`<div class="page-heading order-details-heading"><button class="back-btn" id="orderDetailsBack" aria-label="Back to orders">‹</button><div><span class="eyebrow">ORDER</span><h1>Order details</h1></div></div><div class="order-detail-card"><div class="order-head"><div><strong>${esc(order.id)}</strong><div class="order-date">${esc(formatDate(order.createdAt))}</div></div><span class="status ${statusClass(order.status)}">${esc(order.status)}</span></div>${progress}</div><div class="order-detail-card"><div class="detail-title"><span>📍</span><strong>Delivery details</strong></div><div class="detail-address">${esc(addressText(order))}</div>${a.landmark?`<div class="detail-muted">Landmark: ${esc(a.landmark)}</div>`:''}${a.note?`<div class="detail-muted">Note: ${esc(a.note)}</div>`:''}<div class="detail-row"><span>🚚 Delivery plan</span><strong>${esc(planText(order.deliveryPlan))}</strong></div><div class="detail-row"><span>💵 Payment</span><strong>${esc(paymentText(order))}</strong></div></div><div class="order-detail-card"><div class="detail-title"><span>🛒</span><strong>Items in this order</strong><span class="detail-count">${items.length} ${items.length===1?'product':'products'}</span></div><div class="detail-items">${items.map(i=>`<div class="detail-item"><span class="detail-item-emoji">${esc(i.emoji||'🛒')}</span><div><strong>${esc(i.name)}</strong><small>${esc(i.unit)} · Qty: ${Number(i.qty||0)}</small></div><strong>${money(i.lineTotal??Number(i.price||0)*Number(i.qty||0))}</strong></div>`).join('')}</div></div><div class="order-detail-card"><div class="detail-title"><span>🧾</span><strong>Order summary</strong></div><div class="detail-row"><span>Items total</span><strong>${money(order.total)}</strong></div><div class="detail-row total"><span>Total</span><strong>${money(order.total)}</strong></div></div><button class="secondary-btn full" id="orderHelpBtn">💬 Need help with this order?</button>`;
    $$('.view').forEach(v=>v.classList.remove('active-view'));
    view.classList.add('active-view');
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav==='orders'));
    window.scrollTo({top:0,behavior:'smooth'});
    $('#orderDetailsBack').onclick=()=>setView('orders');
    $('#orderHelpBtn').onclick=()=>toast(`Order ${order.id} · Please contact FreshWay support with this order ID.`);
  }

  window.renderOrders=renderOrders;
  window.openOrderDetails=openOrderDetails;

  document.addEventListener('click',e=>{
    const card=e.target.closest?.('.order-summary-card');
    if(card)openOrderDetails(card.dataset.orderId);
    if(e.target.closest?.('#brandHome'))setView('home');
  });
  document.addEventListener('keydown',e=>{
    const card=e.target.closest?.('.order-summary-card');
    if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openOrderDetails(card.dataset.orderId)}
  });
})();
