const FreshWayPwaInstall=(()=>{
  let deferredPrompt=null;
  let installNudgeShown=false;

  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
  const getRow=()=>document.querySelector('#pwaInstallRow');
  const canUseSessionStorage=()=>{try{return typeof sessionStorage!=='undefined'}catch(_){return false}};
  const nudgeSeen=()=>canUseSessionStorage()&&sessionStorage.getItem('freshway-pwa-install-nudge')==='1';
  const markNudgeSeen=()=>{if(canUseSessionStorage())sessionStorage.setItem('freshway-pwa-install-nudge','1')};

  const setAvailable=(available)=>{
    const row=getRow();
    if(!row)return;
    row.hidden=isStandalone();
    const small=row.querySelector('small');
    if(small){
      small.textContent=available
        ?'Install FreshWay on this device for faster access.'
        :isIos()
          ?'Use Share → Add to Home Screen to install FreshWay.'
          :'Tap here to install, or use your browser menu → Install app.';
    }
  };

  const showInstallHelp=({auto=false}={})=>{
    if(isStandalone()||installNudgeShown)return;
    installNudgeShown=true;
    markNudgeSeen();

    const modal=document.createElement('div');
    modal.className='modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','pwaInstallHelpTitle');

    const nativeAvailable=Boolean(deferredPrompt);
    const instruction=nativeAvailable
      ?'Install FreshWay for faster access, an app-style window, and a home-screen icon.'
      :isIos()
        ?'In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.'
        :'Tap the browser menu <strong>⋮</strong>, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.';
    const actionLabel=nativeAvailable?'Install FreshWay':'Show install steps';

    modal.innerHTML='<div class="modal-sheet pwa-help"><div class="modal-head"><div><span class="eyebrow">FRESHWAY APP</span><h2 id="pwaInstallHelpTitle">Install FreshWay</h2></div><button class="icon-btn" type="button" aria-label="Close">×</button></div><p>'+instruction+'</p><button class="primary-btn full pwa-install-action" type="button">'+actionLabel+'</button><button class="secondary-btn full pwa-install-later" type="button">Not now</button></div>';

    const close=()=>{
      modal.remove();
      installNudgeShown=false;
    };

    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    modal.querySelector('.icon-btn').addEventListener('click',close);
    modal.querySelector('.pwa-install-later').addEventListener('click',close);
    modal.querySelector('.pwa-install-action').addEventListener('click',async()=>{
      if(deferredPrompt){
        const prompt=deferredPrompt;
        deferredPrompt=null;
        try{
          prompt.prompt();
          const choice=await prompt.userChoice;
          if(choice?.outcome==='accepted'){
            const row=getRow();
            if(row)row.hidden=true;
            close();
          }else{
            setAvailable(false);
            close();
          }
        }catch(_){
          setAvailable(false);
          close();
        }
      }else{
        close();
      }
    });

    document.body.appendChild(modal);
  };

  const registerServiceWorker=async()=>{
    if(!('serviceWorker' in navigator))return null;
    try{
      return await navigator.serviceWorker.register('/sw.js',{scope:'/'});
    }catch(_){
      return null;
    }
  };

  const install=async()=>{
    if(isStandalone())return;
    if(deferredPrompt){
      const prompt=deferredPrompt;
      deferredPrompt=null;
      try{
        prompt.prompt();
        const choice=await prompt.userChoice;
        if(choice?.outcome==='accepted'){
          const row=getRow();
          if(row)row.hidden=true;
        }else{
          setAvailable(false);
        }
      }catch(_){
        setAvailable(false);
      }
      return;
    }
    showInstallHelp();
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
    setAvailable(Boolean(deferredPrompt));
  };

  const scheduleInstallNudge=()=>{
    if(isStandalone()||nudgeSeen())return;
    window.setTimeout(()=>{
      if(!isStandalone()&&!nudgeSeen())showInstallHelp({auto:true});
    },3000);
  };

  const init=()=>{
    addRow();
    window.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();
      deferredPrompt=event;
      addRow();
      setAvailable(true);
      if(!nudgeSeen())window.setTimeout(()=>showInstallHelp(),700);
    });
    window.addEventListener('appinstalled',()=>{
      deferredPrompt=null;
      const row=getRow();
      if(row)row.hidden=true;
      installNudgeShown=false;
    });
    window.addEventListener('pageshow',()=>{
      addRow();
      setAvailable(Boolean(deferredPrompt));
    });
    const register=()=>{void registerServiceWorker()};
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
    scheduleInstallNudge();
  };

  return{init,install};
})();

window.FreshWayPwaInstall=FreshWayPwaInstall;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPwaInstall.init(),{once:true});else FreshWayPwaInstall.init();
