// Customer feedback boundary.
// Owns transient toast presentation so feature modules do not duplicate notification timing logic.
(function(){
  const show=(document,msg,duration=2600)=>{
    const t=document.querySelector('#toast');
    if(!t)return;
    t.textContent=String(msg??'');
    t.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast=setTimeout(()=>t.classList.remove('show'),duration);
  };
  window.FreshWayCustomerFeedback=Object.freeze({show});
})();
