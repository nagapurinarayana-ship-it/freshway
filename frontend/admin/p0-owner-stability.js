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

  window.addEventListener('popstate',()=>{
    const id=location.hash.slice(1)||'overview';
    restoring=true;
    try{
      if(typeof window.navigateAdminScreen==='function')window.navigateAdminScreen(id,true);
    }finally{restoring=false}
  });
})();
