// Customer view-state boundary.
// Persists and restores the current customer view without owning navigation itself.
(function(){
  const VIEW_KEY='freshway-current-view-v1';
  const saveView=name=>{if(name)sessionStorage.setItem(VIEW_KEY,name)};
  const clickedView=target=>{
    const nav=target.closest?.('[data-nav]');
    if(nav)return nav.dataset.nav;
    const back=target.closest?.('.back-btn');
    if(back)return back.dataset.back;
    if(target.closest?.('#viewCartBtn'))return'cart';
    if(target.closest?.('#checkoutBtn'))return'checkout';
    if(target.closest?.('#profileBtn'))return'profile';
    if(target.closest?.('#brandHome'))return'home';
    if(target.closest?.('#confirmationOrders'))return'orders';
    if(target.closest?.('#confirmationHome'))return'home';
    return null;
  };
  const bind=({document,window})=>{
    if(!document||!window||document.__freshwayViewStateBound)return;
    document.__freshwayViewStateBound=true;
    document.addEventListener('click',e=>{const name=clickedView(e.target);if(name)saveView(name)});
    const restore=()=>{
      const saved=sessionStorage.getItem(VIEW_KEY);
      if(saved&&typeof window.setView==='function'){
        if(saved==='confirmation'&&typeof window.showConfirmation==='function'&&window.state?.orders?.[0])window.showConfirmation(window.state.orders[0]);
        else window.setView(saved);
      }
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',restore,{once:true});
    else restore();
  };
  window.FreshWayCustomerViewState=Object.freeze({VIEW_KEY,saveView,clickedView,bind});
  bind({document,window});
})();