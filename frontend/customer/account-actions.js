// Customer account actions. Notification status/recovery lives here; push subscription stays in notifications.js.
(function(){
  const showToast=(document,msg,duration)=>{
    const t=document.querySelector('#toast');
    if(!t)return;
    t.textContent=String(msg??'');
    t.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast=setTimeout(()=>t.classList.remove('show'),duration);
  };
  const standaloneApp=()=>{
    try{return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator?.standalone===true)}
    catch(_){return window.navigator?.standalone===true}
  };
  const bind=({document,auth,notifications})=>{
    if(!document||!auth||!notifications||document.__freshwayAccountActionsBound)return;
    document.__freshwayAccountActionsBound=true;
    const refreshNotificationStatus=async()=>{
      const element=document.querySelector('#notificationStatus');
      if(!element||typeof notifications.getStatus!=='function')return null;
      try{
        const status=await notifications.getStatus();
        element.textContent=status.label;
        element.dataset.permissionState=status.state;
        element.setAttribute('role','status');
        element.setAttribute('aria-live','polite');
        return status;
      }catch(_){return null}
    };
    const showNotificationPermissionHelp=()=>{
      let modal=document.querySelector('#notificationPermissionHelp');
      if(modal){modal.classList.remove('hidden');return}
      const appMode=standaloneApp();
      const intro=appMode
        ?'FreshWay is installed as an app. Android controls whether it may show notifications.'
        :'Notifications are blocked for this site. Allow them in Chrome, then return to FreshWay.';
      const steps=appMode
        ?'<ol><li>Open Android Settings.</li><li>Choose Apps → FreshWay → Notifications.</li><li>Turn notifications on. If FreshWay is not listed, open Chrome → Settings → Site settings → Notifications → fwcoldpressed.in → Allow.</li></ol>'
        :'<ol><li>Open Chrome and tap ⋮.</li><li>Choose Settings → Site settings → Notifications.</li><li>Find fwcoldpressed.in and choose Allow.</li></ol>';
      modal=document.createElement('div');
      modal.id='notificationPermissionHelp';
      modal.className='modal';
      modal.setAttribute('role','dialog');
      modal.setAttribute('aria-modal','true');
      modal.setAttribute('aria-labelledby','notificationPermissionTitle');
      modal.innerHTML='<div class="modal-sheet"><div class="modal-head"><div><span class="eyebrow">FRESHWAY NOTIFICATIONS</span><h2 id="notificationPermissionTitle">Allow order updates</h2></div><button type="button" class="icon-btn" data-notification-permission-close aria-label="Close">×</button></div><p id="notificationPermissionIntro"></p><div id="notificationPermissionSteps"></div><p id="notificationPermissionCheckStatus" role="status" aria-live="polite"></p><button type="button" class="primary-btn full" data-notification-permission-check>Check again</button><button type="button" class="secondary-btn full" data-notification-permission-close>Not now</button></div>';
      modal.querySelector('#notificationPermissionIntro').textContent=intro;
      modal.querySelector('#notificationPermissionSteps').innerHTML=steps;
      const close=()=>modal.remove();
      modal.querySelectorAll('[data-notification-permission-close]').forEach(button=>button.addEventListener('click',close));
      modal.addEventListener('click',event=>{if(event.target===modal)close()});
      modal.querySelector('[data-notification-permission-check]').addEventListener('click',async()=>{
        const check=modal.querySelector('[data-notification-permission-check]');
        const message=modal.querySelector('#notificationPermissionCheckStatus');
        check.disabled=true;
        try{
          const status=await notifications.getStatus();
          if(status.state==='blocked'){
            message.textContent=appMode
              ?'Notifications are still blocked. Turn them on in Android Settings → Apps → FreshWay → Notifications, then check again.'
              :'Notifications are still blocked. Allow them in Chrome site settings for fwcoldpressed.in, then check again.';
            return;
          }
          if(status.permission!=='granted'){
            message.textContent='FreshWay does not have notification permission yet. Complete the steps above, then check again.';
            return;
          }
          close();
          await refreshNotificationStatus();
          if(status.state==='enabled'){
            showToast(document,'FreshWay order updates are already enabled on this device.',2600);
          }else if(!auth.customerId()){
            showToast(document,'Permission is restored. Sign in to connect FreshWay order updates.',3600);
          }else{
            showToast(document,'Permission is restored. Tap App notifications again to finish setup.',3600);
          }
        }catch(error){
          message.textContent=error.message||'Could not check notification permission. Try again.';
        }finally{
          if(modal.isConnected)check.disabled=false;
        }
      });
      document.body.appendChild(modal);
      modal.querySelector('[data-notification-permission-close]')?.focus?.();
    };
    document.addEventListener('click',async event=>{
      if(event.target.closest('#privacyPolicyBtn')){window.location.href='/privacy.html';return;}
      if(event.target.closest('#requestAccountDeletionBtn')){
        const session=await auth.session().catch(()=>null);
        if(!session?.customerId){window.location.href='/delete-account.html';return}
        if(!window.confirm('Request deletion of your FreshWay account? Your account will not be deleted immediately. FreshWay will review linked orders and invoices and may retain records required by law.'))return;
        try{
          const result=await fetch('/api/account-deletion/request',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});
          const data=await result.json().catch(()=>({}));
          if(!result.ok)throw new Error(data.error||'Could not record your request.');
          showToast(document,data.alreadyRequested?'A deletion request is already pending.':'Deletion request recorded. FreshWay will review it.',4200);
        }catch(error){showToast(document,error.message||'Could not record your request',3200)}
        return;
      }
      if(event.target.closest('#enableNotifications')){
        const permission=typeof window.Notification!=='undefined'?window.Notification.permission:'unsupported';
        if(permission==='denied'){showNotificationPermissionHelp();return}
        if(!auth.customerId()){
          try{
            await auth.login();
            await refreshNotificationStatus();
            showToast(document,'Mobile verified. Tap App notifications again to enable order updates.',3600);
          }catch(error){
            if(!/cancelled/i.test(error?.message||''))showToast(document,error.message||'Sign in before enabling order updates.',3000);
          }
          return;
        }
        try{
          // Call immediately from this tap; enable() requests permission before its first network await.
          await notifications.enable();
          const status=await refreshNotificationStatus();
          if(status?.state==='enabled')showToast(document,'FreshWay order updates are enabled on this device.',2400);
          else showToast(document,status?.label||'Notifications were allowed, but setup is not complete yet.',3200);
        }catch(error){
          await refreshNotificationStatus();
          if(error?.code==='NOTIFICATION_PERMISSION_DENIED'){showNotificationPermissionHelp();return}
          showToast(document,error.message||'Could not enable notifications. Please try again.',3200);
        }
      }
      if(event.target.closest('#signOutBtn')){
        try{
          await auth.logout();
          const p=document.querySelector('#profilePhone');if(p)p.textContent='Not signed in';
          const n=document.querySelector('#profileName');if(n)n.textContent='Guest customer';
          await refreshNotificationStatus();
          showToast(document,'You have been signed out',2200);
        }catch(error){showToast(document,error.message||'Could not sign out',2800)}
      }
    });
    document.addEventListener('freshway:session',async()=>{
      try{
        const session=await auth.session();
        const phone=document.querySelector('#profilePhone');
        if(phone)phone.textContent=session?.customerId?'Mobile verified':'Not signed in';
        const name=document.querySelector('#profileName');
        if(name&&session?.name)name.textContent=session.name;
      }catch(_){}
      await refreshNotificationStatus();
    });
    document.addEventListener('freshway:notification-status-changed',()=>void refreshNotificationStatus());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshNotificationStatus()});
    window.addEventListener('focus',()=>void refreshNotificationStatus());
    window.addEventListener('pageshow',()=>void refreshNotificationStatus());
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void refreshNotificationStatus(),{once:true});
    else void refreshNotificationStatus();
  };
  window.FreshWayCustomerAccountActions=Object.freeze({bind});
  if(window.FreshWayCustomerAuth&&window.FreshWayCustomerNotifications)bind({document,auth:window.FreshWayCustomerAuth,notifications:window.FreshWayCustomerNotifications});
})();
