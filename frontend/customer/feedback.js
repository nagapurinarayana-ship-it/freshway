// Customer feedback boundary.
// Owns transient toast presentation so feature modules do not duplicate notification timing logic.
(function(){
  const clear=(document)=>{
    clearTimeout(window.__toast);
    window.__toast=null;
    const t=document?.querySelector('#toast');
    if(!t)return;
    t.classList.remove('show');
    t.textContent='';
  };
  const show=(document,msg,duration=2600)=>{
    const text=String(msg??'');
    const t=document?.querySelector('#toast');
    if(!t)return;
    const cartOrCheckout=!!(
      document.querySelector('#cartView.active-view') ||
      document.querySelector('#checkoutView.active-view')
    );
    if(cartOrCheckout&&/^Added(?:\s|$)/i.test(text)){
      clear(document);
      return;
    }
    t.textContent=text;
    t.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast=setTimeout(()=>t.classList.remove('show'),duration);
  };
  window.FreshWayCustomerFeedback=Object.freeze({show,clear});
})();
