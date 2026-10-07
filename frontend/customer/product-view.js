// Customer product-view boundary.
// Owns only product-grid DOM rendering; cart state and quantity behavior remain in app.js.
(function(){
  const media=window.FreshWayCatalogueMedia;
  const render=(products,state,filter,{esc,money,changeQty,updateCartBar})=>{
    const grid=document.querySelector('#productGrid');
    if(!grid)return;
    const q=String(filter||'').trim().toLowerCase();
    const list=products.filter(p=>p.active!==0&&String(p.name).toLowerCase().includes(q));
    const count=document.querySelector('.count-pill');
    if(count)count.textContent=`${list.length} ${list.length===1?'item':'items'}`;
    grid.innerHTML=list.map(p=>{
      const qty=Number(state.cart[p.id]||0);
      const stock=String(p.stock_status||'not_tracked');
      const out=stock==='out_of_stock';
      const stockLabel=stock==='out_of_stock'?'Out of stock':stock==='low_stock'?'Low stock':stock==='in_stock'?'In stock':'Available';
      const stockClass=out?'stock-out':stock==='low_stock'?'stock-low':'stock-ok';
      const action=qty
        ? `<div class="qty-control"><button data-minus="${esc(p.id)}" aria-label="Remove one ${esc(p.name)}">−</button><span>${qty}</span>${out?'<span class="stock-cart-warning">Unavailable</span>':'<button data-plus="'+esc(p.id)+'" aria-label="Add one '+esc(p.name)+'">+</button>'}</div>`
        : `<button class="add-btn" data-add="${esc(p.id)}" ${out?'disabled aria-disabled="true"':''}>${out?'OUT OF STOCK':'ADD'}</button>`;
      const image=media?.image('products',p.id);const visual=image?`<img src="${esc(image)}" alt="" loading="lazy" decoding="async">`:esc(p.emoji);
      return `<article class="product-card"><div class="product-image">${image?visual.replace('alt=""','alt="'+esc(p.name)+'"'):visual}</div><h3>${esc(p.name)}</h3><div class="product-meta">${stockLabel} · ${esc(p.unit)}</div><div class="product-actions"><span class="product-price">${money(p.price)}<small>/${esc(p.unit)}</small></span><span class="stock-pill ${stockClass}">${stockLabel}</span>${action}</div></article>`;
    }).join('')||'<div class="empty" style="grid-column:1/-1"><strong>No products found</strong><br>Try another search.</div>';
    updateCartBar();
  };
  window.FreshWayCustomerProductView=Object.freeze({render});
})();