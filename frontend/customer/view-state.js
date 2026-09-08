// Customer view-state boundary.
// Keeps sessionStorage view persistence outside index.html while preserving the current key and restore behavior.
(function(){
  const KEY='freshway-current-view-v1';
  const save=name=>{if(name)sessionStorage.setItem(KEY,name)};
  const clickedView=target=>{
    const nav=target?.closest?.('[data-nav]');
    if(nav)return nav.dataset.nav;
    const back=target?.closest?.('.back-btn');
    if(back)return back.dataset.back;
    if(target?.closest?.('#viewCartBtn'))return'cart';
    if(target?.closest?.('#checkoutBtn'))return'checkout';
    if(target?.closest?.('#profileBtn'))return'profile';
    if(target?.closest?.'#brandHome')return'home';
    if(target?.closest?.('#confirmationOrders'))return'orders';
    if(target?.closest?.('#confirmationHome'))return'home';
    return null;
  };
  const restore=({sessionStorage,window})=>{
    const saved=sessionStorage.getItem(KEY);
    if(!saved||typeof window.setView!=='function')return;
    if(saved==='confirmation'&&typeof window.showConfirmation==='function'&&window.state?.orders?.[0])window.showConfirmation(window.state.orders[0]);
    else window.setView(saved);
  };
  const bind=({document,sessionStorage,window})=>{
    if(!document||!sessionStorage||!window)return;
    if(document.__freshwayViewStateBound)return;
    document.__freshwayViewStateBound=true;
    document.addEventListener('click',e=>save(clickedView(e.target)));
    const run=()=>restore({sessionStorage,window});
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});
    else run();
  };
  window.FreshWayCustomerViewState=Object.freeze({KEY,save,clickedView,restore,bind});
})();
