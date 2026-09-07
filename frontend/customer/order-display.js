// Customer order display boundary.
// Pure formatting helpers shared by order and delivery-plan views.
(function(){
  const formatDate=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?String(v||''):d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})};
  const planText=p=>p==='Today'?'Today':p==='Tomorrow'?'Tomorrow':p==='Later'?'Later':p==='Unscheduled'?'To be planned':'Planned';
  window.FreshWayCustomerOrderDisplay=Object.freeze({formatDate,planText});
})();