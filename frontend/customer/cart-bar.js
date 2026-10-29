// Customer cart-bar boundary.
// Owns cart-count/floating-bar UI only. Checkout payable totals belong to the server quote.
(function(){
  const update=(document,{count,total,money})=>{
    if(!document||typeof money!=='function')return;
    const n=Number(count)||0;
    const value=Number(total)||0;
    const item=document.querySelector('#cartCount');
    const totalEl=document.querySelector('#cartTotal');
    const badge=document.querySelector('#cartBadge');
    const bar=document.querySelector('#cartBar');
    if(item)item.textContent=`${n} ${n===1?'item':'items'}`;
    if(totalEl)totalEl.textContent=money(value);
    if(badge){badge.textContent=n;if(typeof badge.setAttribute==='function')badge.setAttribute('aria-label',`${n} ${n===1?'item':'items'} in cart`);badge.classList.toggle('hidden',!n)}
    const ordersActive=!!document.querySelector('#ordersView.active-view');
    const checkoutActive=!!document.querySelector('#checkoutView.active-view');
    const cartActive=!!document.querySelector('#cartView.active-view');
    const showBar=n>0&&!ordersActive&&!checkoutActive&&!cartActive;
    if(bar){bar.classList.toggle('hidden',!showBar);document.documentElement.classList.toggle('fw-cart-bar-visible',showBar)}
  };
  window.FreshWayCustomerCartBar=Object.freeze({update});
})();
