// Customer view-state boundary.
// Restores the route represented by this browser-history entry before showing the app.
(function(){
  const VIEW_KEY='freshway-current-view-v1';
  const VALID_VIEWS=new Set(['home','cart','checkout','orders','messages','profile','about','contact','confirmation']);
  let restored=false;

  const saveView=name=>{
    if(!VALID_VIEWS.has(name))return;
    try{sessionStorage.setItem(VIEW_KEY,name)}catch(_){}
  };
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
  const resolveInitialView=window=>{
    const historyView=window.history?.state?.__freshwayCustomer?window.history.state.view:null;
    if(VALID_VIEWS.has(historyView))return historyView;
    const hash=String(window.location?.hash||'').replace(/^#/,'');
    if(VALID_VIEWS.has(hash)&&hash!=='confirmation')return hash;
    let saved=null;
    try{saved=sessionStorage.getItem(VIEW_KEY)}catch(_){}
    return VALID_VIEWS.has(saved)?saved:'home';
  };
  const restore=({document,window}={})=>{
    if(!document||!window||typeof window.setView!=='function')return false;
    if(restored){
      document.documentElement?.classList?.remove('fw-view-restore-pending');
      return true;
    }
    let name=resolveInitialView(window);
    if(name==='confirmation'){
      if(typeof window.showConfirmation==='function'&&window.state?.orders?.[0]){
        window.showConfirmation(window.state.orders[0]);
      }else{
        name='orders';
        window.setView(name,{history:'replace'});
      }
    }else{
      window.setView(name,{history:'replace'});
    }
    saveView(name);
    restored=true;
    document.documentElement?.classList?.remove('fw-view-restore-pending');
    return true;
  };
  const bind=({document,window})=>{
    if(!document||!window||document.__freshwayViewStateBound)return;
    document.__freshwayViewStateBound=true;
    document.addEventListener('click',e=>{const name=clickedView(e.target);if(name)saveView(name)});
    window.addEventListener('popstate',event=>{
      const state=event.state;
      saveView(state?.__freshwayCustomer&&VALID_VIEWS.has(state.view)?state.view:'home');
    });
    const attemptRestore=()=>{if(!restore({document,window}))window.addEventListener('load',()=>restore({document,window}),{once:true})};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attemptRestore,{once:true});
    else attemptRestore();
  };
  window.FreshWayCustomerViewState=Object.freeze({KEY:VIEW_KEY,VIEW_KEY,saveView,clickedView,restore,bind});
  if(typeof document!=='undefined'&&typeof window!=='undefined')bind({document,window});
})();