const FreshWayPwaInstall=(()=>{
  let deferredPrompt=null;
  let installNudgeShown=false;

  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
  const getRow=()=>document.querySelector('#pwaInstallRow');

  const setAvailable=()=>{
    const row=getRow();
    if(!row)return;
    row.hidden=isStandalone();
    const small=row.querySelector('small');
    if(small){
      small.textContent=deferredPrompt
        ?'Tap here to install FreshWay as an app.'
        :isIos()
          ?'Use Share → Add to Home Screen to install FreshWay.'
          :'Use your browser menu → Install app or Add to Home screen.';
    }
  };

  const runNativeInstall=async()=>{
    if(!deferredPrompt)return{accepted:false,unavailable:true};
    const promptEvent=deferredPrompt;
    deferredPrompt=null;
    setAvailable();
    try{
      promptEvent.prompt();
      const choice=await promptEvent.userChoice;
      const accepted=choice?.outcome==='accepted';
      if(accepted){
        const row=getRow();
        if(row)row.hidden=true;
      }else{
        setAvailable();
      }
      return{accepted,cancelled:!accepted};
    }catch(error){
      console.error('FreshWay native install prompt failed:',error);
      setAvailable();
      return{accepted:false,error:true};
    }
  };

  const showInstallHelp=()=>{
    if(isStandalone()||installNudgeShown)return;
    installNudgeShown=true;

    const nativeAvailable=Boolean(deferredPrompt);
    const instruction=nativeAvailable
      ?'Install FreshWay to add an app icon and open it in its own app window.'
      :isIos()
        ?'In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.'
        :'Tap the browser menu <strong>⋮</strong>, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.';
    const actionLabel=nativeAvailable?'Install FreshWay':'Got it';
    const modal=document.createElement('div');
    modal.className='modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','pwaInstallHelpTitle');
    modal.innerHTML='<div class="modal-sheet pwa-help"><div class="modal-head"><div><span class="eyebrow">FRESHWAY APP</span><h2 id="pwaInstallHelpTitle">Install FreshWay</h2></div><button class="icon-btn" type="button" aria-label="Close">×</button></div><p>'+instruction+'</p><button class="primary-btn full pwa-install-action" type="button">'+actionLabel+'</button><button class="secondary-btn full pwa-install-later" type="button">Not now</button></div>';

    const close=()=>{
      modal.remove();
      installNudgeShown=false;
    };
    const updateFallbackMessage=()=>{
      const paragraph=modal.querySelector('p');
      if(paragraph)paragraph.innerHTML=isIos()
        ?'In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.'
        :'Chrome could not open the install prompt. Tap the browser menu <strong>⋮</strong>, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.';
      const action=modal.querySelector('.pwa-install-action');
      if(action)action.textContent='Got it';
    };

    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    modal.querySelector('.icon-btn').addEventListener('click',close);
    modal.querySelector('.pwa-install-later').addEventListener('click',close);
    modal.querySelector('.pwa-install-action').addEventListener('click',async()=>{
      if(!deferredPrompt){close();return}
      const result=await runNativeInstall();
      if(result.accepted){close();return}
      updateFallbackMessage();
    });

    document.body.appendChild(modal);
  };

  const install=async()=>{
    if(isStandalone())return;
    if(deferredPrompt){
      const result=await runNativeInstall();
      if(!result.accepted)showInstallHelp();
      return;
    }
    showInstallHelp();
  };

  const registerServiceWorker=async()=>{
    if(!('serviceWorker' in navigator))return null;
    try{
      return await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    }catch(error){
      console.error('FreshWay service-worker registration failed:',error);
      return null;
    }
  };

  const addRow=()=>{
    const menu=document.querySelector('.menu-card');
    if(!menu||document.querySelector('#pwaInstallRow'))return;
    const row=document.createElement('button');
    row.id='pwaInstallRow';
    row.className='pwa-install-row';
    row.type='button';
    row.innerHTML='<span aria-hidden="true">⬇</span><div><strong>Install FreshWay</strong><small>Install FreshWay on this device for faster access.</small></div><b aria-hidden="true">›</b>';
    row.addEventListener('click',install);
    const notifications=document.querySelector('#enableNotifications');
    if(notifications?.parentNode===menu)menu.insertBefore(row,notifications);else menu.appendChild(row);
    setAvailable();
  };

  const init=()=>{
    addRow();
    window.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();
      deferredPrompt=event;
      addRow();
      setAvailable();
    });
    window.addEventListener('appinstalled',()=>{
      deferredPrompt=null;
      const row=getRow();
      if(row)row.hidden=true;
      installNudgeShown=false;
    });
    window.addEventListener('pageshow',()=>{
      addRow();
      setAvailable();
    });
    const register=()=>{void registerServiceWorker()};
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
  };

  return{init,install,showInstallHelp};
})();

window.FreshWayPwaInstall=FreshWayPwaInstall;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPwaInstall.init(),{once:true});else FreshWayPwaInstall.init();
