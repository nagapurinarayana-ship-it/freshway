// Customer cart-view boundary.
// Owns only cart DOM rendering; cart state/calculation stays in catalogue-cart.js.
(function(){
  const render=(items,total,{esc,money,setView})=>{
    const el=document.querySelector('#cartItems');
    const sum=document.querySelector('#cartSummary');
    if(!el||!sum)return;
    if(!items.length){
      el.innerHTML='<div class="empty"><div style="font-size:38px">🛒</div><strong>Your cart is empty</strong><br>Add some fresh products to continue.</div>';
      sum.innerHTML='';
      return;
    }
    el.innerHTML=items.map(x=>`<article class="order-card"><div class="order-head"><strong>${esc(x.product.emoji)} ${esc(x.product.name)}</strong><strong>${money(x.product.price*x.qty)}</strong></div><div class="order-items"><div class="order-line"><span>${x.qty} × ${esc(x.product.unit)}</span><span>${money(x.product.price)} / ${esc(x.product.unit)}</span></div></div><div class="product-actions"><span class="product-meta" style="margin:0">Quantity</span><div class="qty-control"><button data-minus="${esc(x.product.id)}">−</button><span>${x.qty}</span><button data-plus="${esc(x.product.id)}">+</button></div></div></article>`).join('');
    sum.innerHTML=`<div class="summary-line"><span>Products</span><strong>${money(total)}</strong></div><div class="summary-line"><span>Delivery</span><strong>Offline delivery</strong></div><div class="summary-line total"><span>Total</span><span>${money(total)}</span></div><button class="primary-btn full" id="checkoutBtn">Continue to address</button>`;
  };
  window.FreshWayCustomerCartView=Object.freeze({render});
})();
