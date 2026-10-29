// Customer cart-view boundary.
// Owns only cart DOM rendering; cart state/calculation stays in catalogue-cart.js.
(function(){
  let lastRenderedItems=null;
  const snapshotItems=items=>(Array.isArray(items)?items:[]).map(item=>{
    const p=item.product||{};
    return {qty:item.qty,product:{id:p.id,name:p.name,unit:p.unit,price:p.price,emoji:p.emoji,image_mime_type:p.image_mime_type,image_data:p.image_data,unavailable:p.unavailable===true}};
  });
  const sameItems=(items,previous)=>{
    if(!Array.isArray(previous)||items.length!==previous.length)return false;
    return items.every((item,index)=>{
      const p=item.product||{},old=previous[index]||{},q=old.product||{};
      return item.qty===old.qty&&p.id===q.id&&p.name===q.name&&p.unit===q.unit&&p.price===q.price&&p.emoji===q.emoji&&p.image_mime_type===q.image_mime_type&&p.image_data===q.image_data&&(p.unavailable===true)===(q.unavailable===true);
    });
  };
  const render=(items,total,{esc,money,setView})=>{
    const el=document.querySelector('#cartItems');
    const sum=document.querySelector('#cartSummary');
    if(!el||!sum)return;
    if(sameItems(items,lastRenderedItems)){
      const alreadyRendered=items.length
        ?!!(sum.querySelector('#fwDeliveryPricing')&&sum.querySelector('#fwAvailableCoupons'))
        :!!el.querySelector('.empty')&&!sum.innerHTML;
      if(alreadyRendered)return;
    }
    lastRenderedItems=snapshotItems(items);
    if(!items.length){
      el.innerHTML='<div class="empty"><div style="font-size:38px">🛒</div><strong>Your cart is empty</strong><br>Add some fresh products to continue.</div>';
      sum.innerHTML='';
      return;
    }
    el.innerHTML=items.map(x=>{const image=x.product.image_data&&x.product.image_mime_type?'data:'+x.product.image_mime_type+';base64,'+x.product.image_data:'';const title=image?'<div class="cart-product-title"><span class="cart-product-media"><img src="'+esc(image)+'" alt="'+esc(x.product.name)+'" loading="lazy" decoding="async"></span><span><strong>'+esc(x.product.name)+'</strong><small>'+esc(x.product.unit)+'</small></span></div>':'<div class="cart-product-title"><span class="cart-product-media" aria-hidden="true">'+esc(x.product.emoji)+'</span><span><strong>'+esc(x.product.name)+'</strong><small>'+esc(x.product.unit)+'</small></span></div>';return `<article class="order-card" data-fw-cart-product="${esc(x.product.id)}"><div class="order-head"><div style="min-width:0">${title}</div><strong data-fw-cart-line-total>${money(x.product.price*x.qty)}</strong></div><div class="order-items"><div class="order-line"><span>${x.qty} × ${esc(x.product.unit)}</span><span data-fw-cart-unit-price>${money(x.product.price)} / ${esc(x.product.unit)}</span></div></div>${x.product.unavailable?'<p class="fw-offer-error" role="status">This saved item is currently unavailable. Remove it to continue.</p>':''}<div class="product-actions"><span class="product-meta" style="margin:0">Quantity</span><div class="qty-control"><button data-minus="${esc(x.product.id)}">−</button><span>${x.qty}</span><button data-plus="${esc(x.product.id)}">+</button></div></div></article>`}).join('');
    sum.innerHTML=`<div id="fwDeliveryPricing" aria-live="polite"><div class="summary-line"><span>Items subtotal</span><strong>${money(total)}</strong></div><div class="summary-line"><span>Delivery fee</span><strong>Calculating…</strong></div><div class="summary-line total"><span>Total to pay</span><strong>${money(total)}</strong></div></div><section class="fw-coupon-box" aria-label="Apply coupon"><label for="fwCouponCode">Coupon code</label><div class="fw-coupon-actions"><input id="fwCouponCode" type="text" maxlength="40" autocomplete="off" placeholder="Enter code"><button type="button" class="secondary-btn" data-fw-apply-coupon>Apply</button></div><p id="fwCouponStatus" role="status" aria-live="polite"></p><div id="fwAvailableCoupons"><small class="fw-coupon-loading" role="status">Loading available coupons…</small></div></section><button class="primary-btn full" id="checkoutBtn">Continue to address</button>`;
    window.FreshWayCustomerDeliveryOffers?.renderCart({items,total,money});
  };
  window.FreshWayCustomerCartView=Object.freeze({render});
})();
