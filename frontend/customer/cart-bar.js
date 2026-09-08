// Customer cart-bar boundary.
// Owns only cart summary DOM updates; cart calculations remain in catalogue-cart.
(function(){
  const update=(document,{count,total,money})=>{
    if(!document||typeof money!=='function')return;
    const n=Number(count)||0;
    const value=Number(total)||0;
    const item=document.querySelector('#cartCount');
    const totalEl=document.querySelector('#cartTotal');
    const badge=document.querySelector('#cartBadge');
    const bar=document.querySelector('#cartBar');
    const checkoutTotal=document.querySelector('#checkoutTotal');
    if(item)item.textContent=`${n} ${n===1?'item':'items'}`;
    if(totalEl)totalEl.textContent=money(value);
    if(badge){badge.textContent=n;badge.classList.toggle('hidden',!n)}
    if(bar)bar.classList.toggle('hidden',!n);
    if(checkoutTotal)checkoutTotal.textContent=money(value);
  };
  window.FreshWayCustomerCartBar=Object.freeze({update});
})();
