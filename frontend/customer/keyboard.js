// Customer keyboard accessibility boundary.
// Keeps keyboard activation for the branded home control out of index.html.
(function(){
  const bind=({document,onHome})=>{
    if(!document||typeof onHome!=='function'||document.__freshwayKeyboardBound)return;
    const brand=document.querySelector('#brandHome');
    if(!brand)return;
    document.__freshwayKeyboardBound=true;
    brand.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();onHome()}
    });
  };
  window.FreshWayCustomerKeyboard=Object.freeze({bind});
})();
