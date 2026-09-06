(function(){
  const style=document.createElement('style');
  style.textContent=`
    .order-filter-row{display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px;scrollbar-width:none}.order-filter-row::-webkit-scrollbar{display:none}
    .order-filter{flex:0 0 auto;border:1px solid #dce8e2;background:#fff;border-radius:999px;padding:9px 14px;font:inherit;color:#52635c;white-space:nowrap}.order-filter.active{background:#0f7a4b;color:#fff;border-color:#0f7a4b}
    .order-summary-card{cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}.order-summary-card:active{transform:scale(.99)}.order-summary-card:focus-visible{outline:3px solid rgba(15,122,75,.25);outline-offset:2px}
    .order-thumbs{display:flex;gap:8px;margin:14px 0 10px}.order-thumb{width:54px;height:54px;border-radius:13px;background:#f4f8f6;display:grid;place-items:center;font-size:29px;border:1px solid #edf2ef}.order-thumb.more{font-size:15px;font-weight:800;color:#0f7a4b}
    .order-summary-line,.order-summary-meta,.order-open-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.order-summary-line{font-size:15px}.order-summary-meta{margin-top:10px;color:#6c7a74;font-size:13px;flex-wrap:wrap}.order-open-row{margin-top:12px;padding-top:12px;border-top:1px solid #edf1ef;color:#0f7a4b;font-size:13px;font-weight:700}
    #orderDetailsView{padding-bottom:30px}.order-details-heading{display:flex;align-items:center;gap:12px}.order-detail-card{background:#fff;border:1px solid #e6ece9;border-radius:22px;padding:18px;margin:0 0 14px;box-shadow:0 8px 24px rgba(20,55,40,.05)}
    .order-progress{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:22px}.progress-step{position:relative;text-align:center;color:#87938e}.progress-step:not(:last-child)::after{content:'';position:absolute;top:13px;left:62%;right:-38%;height:2px;background:#dfe7e3}.progress-step.done{color:#0f7a4b}.progress-step.done:not(:last-child)::after{background:#0f7a4b}.progress-step span{position:relative;z-index:1;width:28px;height:28px;margin:0 auto 7px;border-radius:50%;display:grid;place-items:center;background:#dfe7e3;font-size:12px;font-weight:800}.progress-step.done span{background:#0f7a4b;color:#fff}.progress-step small{display:block;font-size:11px;line-height:1.25}.order-cancelled{margin-top:16px;padding:12px;border-radius:12px;background:#fff1f1;color:#b42318;font-weight:700}
    .detail-title{display:flex;align-items:center;gap:9px;font-size:16px}.detail-title>span:first-child{font-size:21px}.detail-count{margin-left:auto;color:#718079;font-size:12px;font-weight:600}.detail-address{margin:13px 0;color:#4f6059;line-height:1.5}.detail-muted{font-size:13px;color:#78857f;margin:7px 0}.detail-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #edf1ef;font-size:14px}.detail-row.total{font-size:17px;padding-bottom:0}.detail-items{margin-top:8px}.detail-item{display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:11px;padding:11px 0;border-top:1px solid #edf1ef}.detail-item:first-child{border-top:0}.detail-item-emoji{width:52px;height:52px;border-radius:12px;background:#f4f8f6;display:grid;place-items:center;font-size:27px}.detail-item small{display:block;color:#78857f;margin-top:4px;font-size:12px}.order-detail-card+.secondary-btn{margin-top:2px}
    @media(max-width:430px){.order-thumb{width:48px;height:48px}.order-progress{gap:0}.progress-step small{font-size:10px}.order-detail-card{padding:15px;border-radius:18px}}
  `;
  document.head.appendChild(style);

  const statusClass=s=>String(s||'').toLowerCase().replace(/\s+/g,'-');
  const itemCount=o=>(o.items||[]).reduce((n,i)=>n+Number(i.qty||0),0);
  const itemWord=n=>n===1?'item':'items';
  const emojiFor=i=>i.emoji||(PRODUCTS.find(p=>p.id===i.id||p.name===i.name)?.emoji)||'🛒';
  const itemThumbs=o=>{
    const items=o.items||[];
    const visible=items.slice(0,4).map(i=>`<span class="order-thumb" title="${esc(i.name)}">${esc(emojiFor(i))}</span>`).join('');
    const more=items.length>4?`<span class="order-thumb more">+${items.length-4}</span>`:'';
    return `<div class="order-thumbs">${visible}${more}</div>`;
  };
  const deliveryText=o=>o.status==='Delivered'?'Delivered':`Delivery: ${planText(o.deliveryPlan)}`;
  const paymentText=o=>o.payment==='Collected'?'Cash collected':'Cash on delivery';
  const addressText=o=>{const a=o.address||{};return [a.house,a.area,a.city].filter(Boolean).join(', ')+(a.pincode?` - ${a.pincode}`:'')};

  function renderOrders(list=state.orders){
    const el=$('#customerOrders');
    if(!el)return;
    if(!list.length){el.innerHTML='<div class="empty"><div style="font-size:38px">📦</div><strong>No orders yet</strong><br>Your placed orders will appear here.</div>';return}
    el.innerHTML=`<div class="order-filter-row" role="tablist" aria-label="Order status"><button class="order-filter active" data-order-filter="All">All</button><button class="order-filter" data-order-filter="Ordered">Ordered</button><button class="order-filter" data-order-filter="Processing">Processing</button><button class="order-filter" data-order-filter="Out for Delivery">Out for Delivery</button><button class="order-filter" data-order-filter="Delivered">Delivered</button><button class="order-filter" data-order-filter="Cancelled">Cancelled</button></div><div id="orderCards">${list.map(o=>`<article class="order-card order-summary-card" data-order-id="${esc(o.id)}" tabindex="0" role="button" aria-label="Open order ${esc(o.id)}"><div class="order-head"><div><strong>${esc(o.id)}</strong><div class="order-date">${esc(formatDate(o.createdAt))}</div></div><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></div>${itemThumbs(o)}<div class="order-summary-line"><strong>${itemCount(o)} ${itemWord(itemCount(o))}</strong><strong>${money(o.total)}</strong></div><div class="order-summary-meta"><span>🚚 ${esc(deliveryText(o))}</span><span>💵 ${esc(paymentText(o))}</span></div><div class="order-open-row"><span>View order details</span><b>›</b></div></article>`).join('')}</div>`;
    installOrderFilters();
  }

  function installOrderFilters(){
    $$('.order-filter').forEach(btn=>btn.onclick=()=>{$$('.order-filter').forEach(x=>x.classList.remove('active'));btn.classList.add('active');const value=btn.dataset.orderFilter;$$('#orderCards .order-summary-card').forEach(card=>{const order=state.orders.find(o=>o.id===card.dataset.orderId);card.style.display=(!order||value==='All'||order.status===value)?'':'none'})});
  }

  function statusStep(status){if(status==='Cancelled')return -1;if(status==='Delivered')return 3;if(status==='Out for Delivery')return 2;if(status==='Processing')return 1;return 0}

  function openOrderDetails(id){
    const order=state.orders.find(o=>o.id===id);
    if(!order){toast('Order details are not available on this device.');return}
    let view=$('#orderDetailsView');
    if(!view){view=document.createElement('section');view.id='orderDetailsView';view.className='view';document.querySelector('main')?.appendChild(view)}
    const step=statusStep(order.status);const steps=[['Ordered',0],['Preparing',1],['Out for Delivery',2],['Delivered',3]];
    const progress=order.status==='Cancelled'?'<div class="order-cancelled">✕ This order was cancelled.</div>':`<div class="order-progress">${steps.map(([label,n],idx)=>`<div class="progress-step ${n<=step?'done':''} ${n===step?'current':''}"><span>${n<=step?'✓':idx+1}</span><small>${label}</small></div>`).join('')}</div>`;
    const a=order.address||{};const items=order.items||[];
    view.innerHTML=`<div class="page-heading order-details-heading"><button class="back-btn" id="orderDetailsBack" aria-label="Back to orders">‹</button><div><span class="eyebrow">ORDER</span><h1>Order details</h1></div></div><div class="order-detail-card"><div class="order-head"><div><strong>${esc(order.id)}</strong><div class="order-date">${esc(formatDate(order.createdAt))}</div></div><span class="status ${statusClass(order.status)}">${esc(order.status)}</span></div>${progress}</div><div class="order-detail-card"><div class="detail-title"><span>📍</span><strong>Delivery details</strong></div><div class="detail-address">${esc(addressText(order))}</div>${a.landmark?`<div class="detail-muted">Landmark: ${esc(a.landmark)}</div>`:''}${a.note?`<div class="detail-muted">Note: ${esc(a.note)}</div>`:''}<div class="detail-row"><span>🚚 Delivery plan</span><strong>${esc(planText(order.deliveryPlan))}</strong></div><div class="detail-row"><span>💵 Payment</span><strong>${esc(paymentText(order))}</strong></div></div><div class="order-detail-card"><div class="detail-title"><span>🛒</span><strong>Items in this order</strong><span class="detail-count">${itemCount(order)} ${itemWord(itemCount(order))}</span></div><div class="detail-items">${items.map(i=>`<div class="detail-item"><span class="detail-item-emoji">${esc(emojiFor(i))}</span><div><strong>${esc(i.name)}</strong><small>${esc(i.unit)} · Qty: ${Number(i.qty||0)}</small></div><strong>${money(i.lineTotal??Number(i.price||0)*Number(i.qty||0))}</strong></div>`).join('')}</div></div><div class="order-detail-card"><div class="detail-title"><span>🧾</span><strong>Order summary</strong></div><div class="detail-row"><span>Items total</span><strong>${money(order.total)}</strong></div><div class="detail-row total"><span>Total</span><strong>${money(order.total)}</strong></div></div><button class="secondary-btn full" id="orderHelpBtn">💬 Need help with this order?</button>`;
    $$('.view').forEach(v=>v.classList.remove('active-view'));view.classList.add('active-view');$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav==='orders'));window.scrollTo({top:0,behavior:'smooth'});
    $('#orderDetailsBack').onclick=()=>setView('orders');$('#orderHelpBtn').onclick=()=>toast(`Order ${order.id} · Please contact FreshWay support with this order ID.`);
  }

  window.renderOrders=renderOrders;window.openOrderDetails=openOrderDetails;
  document.addEventListener('click',e=>{const card=e.target.closest?.('.order-summary-card');if(card)openOrderDetails(card.dataset.orderId);if(e.target.closest?.('#brandHome'))setView('home')});
  document.addEventListener('keydown',e=>{const card=e.target.closest?.('.order-summary-card');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openOrderDetails(card.dataset.orderId)}});
})();
