// Customer search boundary.
// Owns only search-input binding and filtering callbacks; catalogue rendering remains in its feature module.
(function(){
  const bind=({document,render})=>{
    if(!document||typeof render!=='function'||document.__freshwaySearchBound)return;
    const input=document.querySelector('#searchInput');
    if(!input)return;
    document.__freshwaySearchBound=true;
    input.addEventListener('input',()=>render(input.value||''));
  };
  window.FreshWayCustomerSearch=Object.freeze({bind});
})();
