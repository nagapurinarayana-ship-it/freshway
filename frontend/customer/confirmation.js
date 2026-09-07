// Customer confirmation boundary.
// Owns only the post-order confirmation view; navigation and cart updates are injected callbacks.
(function(){
  const show=(order,{esc,planText,setView,updateCartBar})=>{
    const home=document.querySelector('#homeView');
    if(!home)return;
    document.querySelector('#confirmationView')?.remove();
    home.insertAdjacentHTML('afterend',`<section id="confirmationView" class="view active-view"><div class="empty" style="margin-top:20vh"><div style="font-size:55px">🎉</div><span class="eyebrow">ORDER PLACED</span><h1 style="font-size:25px;margin:8px 0">Thank you!</h1><p>Your order <strong>${esc(order.id)}</strong> has been placed successfully.</p><p class="muted">Payment: Cash · Delivery plan: ${esc(planText(order.deliveryPlan))}.</p><button class="primary-btn full" id="confirmationOrders">View my orders</button><button class="secondary-btn full" id="confirmationHome">Continue shopping</button></div></section>`);
    [...document.querySelectorAll('.view')].forEach(v=>{if(v.id!=='confirmationView')v.classList.remove('active-view')});
    [...document.querySelectorAll('.nav-item')].forEach(b=>b.classList.remove('active'));
    document.querySelector('#confirmationOrders').onclick=()=>setView('orders');
    document.querySelector('#confirmationHome').onclick=()=>setView('home');
    updateCartBar();
  };
  window.FreshWayCustomerConfirmation=Object.freeze({show});
})();
