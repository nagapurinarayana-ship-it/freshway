const FreshWayPwaInstall=(()=>{
  let deferredPrompt=null;

  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
  const getRow=()=>document.querySelector('#pwaInstallRow');

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
          :'Use your browser menu → Install app / Add to Home screen.';
    }
  };

  const showInstallHelp=()=>{
    const modal=document.createElement('div');
    modal.className='modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','pwaInstallHelpTitle');
    const instruction=isIos()
      ?'In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.'
      :'Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.';
    modal.innerHTML='<div class="modal-sheet pwa-help"><div class="modal-head"><div><span class="eyebrow">INSTALL FRESHWAY</span><h2 id="pwaInstallHelpTitle">Add FreshWay to your device</h2></div><button class="icon-btn" type="button" aria-label="Close">×</button></div><p>'+instruction+' FreshWay will then open like an app.</p><button class="primary-btn full" type="button">Got it</button></div>';
    const close=()=>modal.remove();
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    modal.querySelector('.icon-btn').addEventListener('click',close);
    modal.querySelector('.primary-btn').addEventListener('click',close);
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

  const init=()=>{
    addRow();
    window.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();
      deferredPrompt=event;
      addRow();
      setAvailable(true);
    });
    window.addEventListener('appinstalled',()=>{
      deferredPrompt=null;
      const row=getRow();
      if(row)row.hidden=true;
    });
    window.addEventListener('pageshow',()=>{
      addRow();
      setAvailable(Boolean(deferredPrompt));
    });
    const register=()=>{void registerServiceWorker()};
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
  };

  return{init,install};
})();

window.FreshWayPwaInstall=FreshWayPwaInstall;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPwaInstall.init(),{once:true});else FreshWayPwaInstall.init();
