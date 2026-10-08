// FreshWay customer state-freshness boundary.
// Keeps server-owned catalogue and order data fresh when the user returns to the app,
// switches views, restores a PWA/browser page, or resumes after backgrounding.
(function(){
  const create=({document,getView,refreshCatalogue,refreshOrders,refreshPromotions,renderProfile,intervalMs=30000}={})=>{
    let timer=null;
    let stopped=false;
    let catalogueAt=0;
    let ordersAt=0;
    let catalogueInFlight=null;
    let ordersInFlight=null;
    const now=()=>Date.now();
    const visible=()=>document?.visibilityState!=='hidden';
    const view=()=>typeof getView==='function'?getView():document?.querySelector('.view.active-view')?.id?.replace(/View$/,'')||'home';
    const catalogueView=name=>['home','cart','checkout'].includes(name);
    const runCatalogue=async(force=false)=>{
      if(stopped||!visible()||typeof refreshCatalogue!=='function'||catalogueInFlight)return;
      if(!force&&now()-catalogueAt<intervalMs)return;
      catalogueInFlight=(async()=>{
        try{await refreshCatalogue();catalogueAt=now()}catch(_){}
        finally{catalogueInFlight=null}
      })();
      await catalogueInFlight;
    };
    const runOrders=async(force=false)=>{
      if(stopped||!visible()||typeof refreshOrders!=='function'||ordersInFlight)return;
      if(!force&&now()-ordersAt<intervalMs)return;
      ordersInFlight=(async()=>{
        try{await refreshOrders();ordersAt=now()}catch(_){}
        finally{ordersInFlight=null}
      })();
      await ordersInFlight;
    };
    const refreshCurrent=async(force=false)=>{
      const name=view();
      if(catalogueView(name))await runCatalogue(force);
      if(force&&typeof refreshPromotions==='function'&&visible())await refreshPromotions();
      if(name==='orders')await runOrders(force);
      if(name==='profile'&&typeof renderProfile==='function')renderProfile();
    };
    const onView=name=>{
      if(catalogueView(name))runCatalogue(true);
      if(catalogueView(name)&&typeof refreshPromotions==='function')refreshPromotions();
      if(name==='orders')runOrders(true);
      if(name==='profile'&&typeof renderProfile==='function')renderProfile();
    };
    const onResume=()=>{if(visible())refreshCurrent(true)};
    const onVisibility=()=>{if(visible())refreshCurrent(true)};
    const start=()=>{
      if(stopped)return;
      if(timer!==null)clearInterval(timer);
      timer=setInterval(()=>refreshCurrent(false),intervalMs);
      refreshCurrent(false);
    };
    const stop=()=>{
      stopped=true;
      if(timer!==null)clearInterval(timer);
      timer=null;
    };
    document?.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('focus',onResume);
    window.addEventListener('pageshow',onResume);
    start();
    return Object.freeze({onView,refresh:()=>refreshCurrent(true),stop});
  };
  window.FreshWayCustomerStateFreshness=Object.freeze({create});
})();
