// Customer cart-actions boundary.
// Owns cart quantity click binding while cart rendering and state mutations remain injected.
(function(){
  const bind=({document,changeQty,toast})=>{
    if(!document||typeof changeQty!=='function'||document.__freshwayCartActionsBound)return;
    document.__freshwayCartActionsBound=true;
    document.addEventListener('click',e=>{
      const t=e.target;
      const add=t.closest?.('[data-add]');
      const plus=t.closest?.('[data-plus]');
      const minus=t.closest?.('[data-minus]');
      if(add)changeQty(add.dataset.add,1);
      if(plus)changeQty(plus.dataset.plus,1);
      if(minus)changeQty(minus.dataset.minus,-1);
      if((add||plus)&&typeof toast==='function')toast('Added to cart');
    });
  };
  window.FreshWayCustomerCartActions=Object.freeze({bind});
})();
