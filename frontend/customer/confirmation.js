// Customer confirmation boundary.
// Owns only the post-order confirmation view; navigation and cart updates are injected callbacks.
(function(){
  const show=(order,{esc,planText,setView,updateCartBar,toast=()=>{}})=>{
    const home=document.querySelector('#homeView');
    if(!home)return;
    document.querySelector('#confirmationView')?.remove();
    const money=window.FreshWayCustomerOrderDisplay?.money||(value=>'₹'+Number(value||0).toLocaleString('en-IN'));
    const breakdown=order.itemsSubtotal==null?'':'<div class="fw-confirmation-pricing"><div><span>Items subtotal</span><strong>'+money(order.itemsSubtotal)+'</strong></div>'+(Number(order.couponDiscount||0)>0?'<div><span>Coupon '+esc(order.couponCode||'')+'</span><strong>−'+money(order.couponDiscount)+'</strong></div>':'')+'<div><span>Delivery fee</span><strong>'+(Number(order.deliveryFee||0)>0?money(order.deliveryFee):'Free')+'</strong></div><div><span>Total to pay</span><strong>'+money(order.total)+'</strong></div></div>';
    home.insertAdjacentHTML('afterend',`<section id="confirmationView" class="view active-view"><div class="empty" style="margin-top:20vh"><div style="font-size:55px">🎉</div><span class="eyebrow">ORDER PLACED</span><h1 style="font-size:25px;margin:8px 0">Thank you!</h1><p>Your order <strong>${esc(order.id)}</strong> has been placed successfully.</p><p class="muted">Payment: Cash · Delivery plan: ${esc(planText(order.deliveryPlan))}.</p>${breakdown}<button class="secondary-btn full" id="confirmationNotifications" type="button">🔔 Enable order updates on this device</button><p id="confirmationNotificationStatus" class="muted" role="status" aria-live="polite">Get notified when your order is confirmed, ready or delivered.</p><button class="primary-btn full" id="confirmationOrders">View my orders</button><button class="secondary-btn full" id="confirmationHome">Continue shopping</button></div></section>`);
    [...document.querySelectorAll('.view')].forEach(v=>{if(v.id!=='confirmationView')v.classList.remove('active-view')});
    [...document.querySelectorAll('.nav-item')].forEach(b=>b.classList.remove('active'));
    const notificationsButton=document.querySelector('#confirmationNotifications');
    const notificationsStatus=document.querySelector('#confirmationNotificationStatus');
    try{
      if(localStorage.getItem('freshway-push-enabled')==='1'&&'Notification'in window&&Notification.permission==='granted'){
        notificationsButton.hidden=true;
        notificationsStatus.textContent='Order notifications are enabled on this device.';
      }
    }catch(_){}
    notificationsButton.onclick=async()=>{
      notificationsButton.disabled=true;
      notificationsButton.textContent='Enabling order updates…';
      try{
        await window.FreshWayCustomerNotifications.enable();
        notificationsButton.hidden=true;
        notificationsStatus.textContent='Order notifications are enabled on this device.';
        toast('Order notifications enabled on this device.');
      }catch(error){
        notificationsButton.disabled=false;
        notificationsButton.textContent='Retry enabling order updates';
        notificationsStatus.textContent=error?.message||'Could not enable order notifications. You can enable them later from Profile.';
      }
    };
    document.querySelector('#confirmationOrders').onclick=()=>setView('orders');
    document.querySelector('#confirmationHome').onclick=()=>setView('home');
    updateCartBar();
  };
  window.FreshWayCustomerConfirmation=Object.freeze({show});
})();
