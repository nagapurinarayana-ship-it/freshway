// Customer authentication-actions boundary.
// Owns login/logout/session UI reactions while preserving the existing secure auth API.
(function(){
  const bind=({document,notifications,window})=>{
    if(!document||!notifications||document.__freshwayAuthActionsBound)return;
    document.__freshwayAuthActionsBound=true;
    document.addEventListener('freshway:session',async()=>{
      try{
        const s=await notifications.session();
        const phone=document.querySelector('#profilePhone');
        const status=document.querySelector('#notificationStatus');
        const login=document.querySelector('#customerLoginBtn');
        if(phone)phone.textContent=s?.customerId?'Mobile verified':'Not signed in';
        if(status)status.textContent=s?.customerId?'Ready for FreshWay updates':'Verify your mobile to enable updates';
        if(login)login.style.display=s?.customerId?'none':'';
      }catch(_){ }
    });
    document.addEventListener('freshway:logout',()=>window?.location?.reload?.());
  };
  window.FreshWayCustomerAuthActions=Object.freeze({bind});
})();
