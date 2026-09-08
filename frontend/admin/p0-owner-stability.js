(()=>{
  if(window.__freshwayP0OwnerStability)return;
  window.__freshwayP0OwnerStability=true;

  const baseRenderProducts=window.renderProducts;
  if(typeof baseRenderProducts==='function'){
    window.renderProducts=function(){
      if(!document.getElementById('productList'))return;
      return baseRenderProducts.apply(this,arguments);
    };
  }

  let restoring=false;
  const baseNavigate=window.navigateAdminScreen;
  if(typeof baseNavigate==='function'){
    window.navigateAdminScreen=function(id,fromHistory=false){
      const current=location.hash.slice(1)||'overview';
      if(!restoring&&!fromHistory&&id&&id!==current){
        history.pushState(null,'',`#${id}`);
      }
      return baseNavigate(id);
    };
  }

  let refreshing=false;
  const refreshCurrent=async()=>{
    if(refreshing)return;
    refreshing=true;
    const id=location.hash.slice(1)||'overview';
    const button=document.getElementById('refreshBtn');
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.dataset.refreshing='1';}
    try{
      if(id==='overview'){
        await Promise.all([loadSummary(),loadBusiness(),loadHome()]);
      }else if(id==='orders'){
        await loadOrders(true);
      }else if(id==='delivery'){
        await loadDelivery(true);
      }else if(id==='cash'){
        await loadCash();
      }else if(id==='customers'){
        await loadCustomers(true);
      }else if(id==='catalogue'){
        if(typeof window.freshWayCatalogueRefresh==='function')await window.freshWayCatalogueRefresh();
        else{
          const d=await api('/admin/products');
          products=d.products||[];
          renderProducts();
        }
      }else if(id==='notifications'){
        await loadHistory();
      }else if(id==='reports'){
        await loadReports();
      }else if(id==='settings'){
        toast('Settings is already current');
      }
    }catch(e){
      if(typeof toast==='function')toast(e.message||'Refresh failed');
    }finally{
      refreshing=false;
      const current=document.getElementById('refreshBtn');
      if(current){current.disabled=false;current.removeAttribute('aria-busy');delete current.dataset.refreshing;}
    }
  };
  window.freshWayOwnerRefresh=refreshCurrent;

  const bindRefresh=()=>{
    const button=document.getElementById('refreshBtn');
    if(!button)return;
    button.type='button';
    button.onclick=null;
    if(button.dataset.refreshBound==='1')return;
    button.dataset.refreshBound='1';
    button.addEventListener('click',e=>{
      e.preventDefault();
      e.stopPropagation();
      refreshCurrent();
    });
  };

  document.addEventListener('click',e=>{
    const target=e.target;
    if(target&&target.closest('#refreshBtn')){
      e.preventDefault();
      e.stopImmediatePropagation();
      refreshCurrent();
    }
  },true);

  const removeDuplicateRefreshControls=()=>{
    document.getElementById('fwRefreshCatalogue')?.remove();
    document.getElementById('refreshHistory')?.remove();
    bindRefresh();
  };

  document.addEventListener('DOMContentLoaded',removeDuplicateRefreshControls,{once:true});
  if(document.body){
    new MutationObserver(removeDuplicateRefreshControls).observe(document.body,{childList:true,subtree:true});
    removeDuplicateRefreshControls();
  }

  window.addEventListener('popstate',()=>{
    const id=location.hash.slice(1)||'overview';
    restoring=true;
    try{
      if(typeof window.navigateAdminScreen==='function')window.navigateAdminScreen(id,true);
    }finally{restoring=false}
  });
})();
