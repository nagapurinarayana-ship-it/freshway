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

  const refreshCurrent=async()=>{
    const id=location.hash.slice(1)||'overview';
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
        const d=await api('/admin/products');
        products=d.products||[];
        renderProducts();
      }else if(id==='notifications'){
        await loadHistory();
      }else if(id==='reports'){
        await loadReports();
      }
    }catch(e){
      if(typeof toast==='function')toast(e.message||'Refresh failed');
    }
  };

  // Keep one consistent Owner refresh control: the top-right control.
  document.addEventListener('click',e=>{
    const target=e.target;
    if(target.closest('#refreshBtn')){
      e.preventDefault();
      e.stopImmediatePropagation();
      refreshCurrent();
    }
  },true);

  const removeDuplicateRefreshControls=()=>{
    document.getElementById('fwRefreshCatalogue')?.remove();
    document.getElementById('refreshHistory')?.remove();
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
