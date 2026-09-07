// Customer navigation boundary.
// Owns view visibility and navigation state; feature rendering is injected from app.js.
(function(){
  const create=({document,onView,afterView=()=>{}})=>{
    const setView=name=>{
      document.querySelector('#confirmationView')?.remove();
      [...document.querySelectorAll('.view')].forEach(v=>v.classList.remove('active-view'));
      const view=document.querySelector(`#${name}View`);
      if(!view)return;
      view.classList.add('active-view');
      [...document.querySelectorAll('.nav-item')].forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
      onView(name);
      afterView(name);
      window.scrollTo({top:0,behavior:'smooth'});
    };
    return Object.freeze({setView});
  };
  window.FreshWayCustomerNavigation=Object.freeze({create});
})();
