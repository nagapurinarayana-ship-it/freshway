// Customer product-view boundary.
// Owns only product-grid DOM rendering; cart state and quantity behavior remain in app.js.
(function(){
  const render=(products,state,filter,{esc,money,changeQty,updateCartBar})=>{
    const grid=document.querySelector('#productGrid');
    if(!grid)return;
    const q=String(filter||'').trim().toLowerCase();
    const list=products.filter(p=>p.active!==0&&String(p.name).toLowerCase().includes(q));
    const count=document.querySelector('.count-pill');
    if(count)count.textContent=`${list.length} ${list.length===1?'item':'items'}`;
    grid.innerHTML=list.map(p=>{
      const qty=Number(state.cart[p.id]||0);
      return `<article class="product-card"><div class="product-image">${esc(p.emoji)}</div><h3>${esc(p.name)}</h3><div class="product-meta">Fresh today · ${esc(p.unit)}</div><div class="product-actions"><span class="product-price">${money(p.price)}<small>/${esc(p.unit)}</small></span>${qty?`<div class="qty-control"><button data-minus="${esc(p.id)}" aria-label="Remove one ${esc(p.name)}">−</button><span>${qty}</span><button data-plus="${esc(p.id)}" aria-label="Add one ${esc(p.name)}">+</button></div>`:`<button class="add-btn" data-add="${esc(p.id)}">ADD</button>`}</div></article>`
    }).join('')||'<div class="empty" style="grid-column:1/-1"><strong>No products found</strong><br>Try another search.</div>';
    updateCartBar();
  };
  window.FreshWayCustomerProductView=Object.freeze({render});
})();
