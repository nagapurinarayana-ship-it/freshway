// Customer account-actions boundary.
// Owns account menu interactions while auth and notification services stay isolated.
(function(){
  const showToast=(document,msg,duration)=>{
    const t=document.querySelector('#toast');
    if(!t)return;
    t.textContent=String(msg??'');
    t.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast=setTimeout(()=>t.classList.remove('show'),duration);
  };
  const bind=({document,auth,notifications})=>{
    if(!document||!auth||!notifications||document.__freshwayAccountActionsBound)return;
    document.__freshwayAccountActionsBound=true;
    document.addEventListener('click',async e=>{
      if(e.target.closest('#enableNotifications')){
        try{
          await notifications.enable();
          const s=document.querySelector('#notificationStatus');
          if(s)s.textContent='Enabled on this device';
          showToast(document,'Notifications enabled on this device',2200);
        }catch(err){showToast(document,err.message||'Could not enable notifications',2800)}
      }
      if(e.target.closest('#signOutBtn')){
        try{
          await auth.logout();
          const s=document.querySelector('#notificationStatus');
          if(s)s.textContent='Verify your mobile to enable updates';
          const p=document.querySelector('#profilePhone');
          if(p)p.textContent='Not signed in';
          const n=document.querySelector('#profileName');
          if(n)n.textContent='Guest customer';
          showToast(document,'You have been signed out',2200);
        }catch(err){showToast(document,err.message||'Could not sign out',2800)}
      }
    });
    document.addEventListener('freshway:session',async()=>{
      try{
        const s=await auth.session();
        const p=document.querySelector('#profilePhone');
        if(p)p.textContent=s?.customerId?'Mobile verified':'Not signed in';
        const n=document.querySelector('#notificationStatus');
        if(n)n.textContent=s?.customerId?'Ready for FreshWay updates':'Verify your mobile to enable updates';
      }catch(_){ }
    });
  };
  window.FreshWayCustomerAccountActions=Object.freeze({bind});
  if(window.FreshWayCustomerAuth&&window.FreshWayCustomerNotifications)bind({document,auth:window.FreshWayCustomerAuth,notifications:window.FreshWayCustomerNotifications});
})();
