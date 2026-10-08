const FreshWayPwaInstall=(()=>{
  let installNudgeShown=false;

  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
  const getRow=()=>document.querySelector('#pwaInstallRow');
  const canUseSessionStorage=()=>{try{return typeof sessionStorage!=='undefined'}catch(_){return false}};
  const nudgeSeen=()=>canUseSessionStorage()&&sessionStorage.getItem('freshway-pwa-install-nudge')==='1';
  const markNudgeSeen=()=>{if(canUseSessionStorage())sessionStorage.setItem('freshway-pwa-install-nudge','1')};

  const setAvailable=()=>{
    const row=getRow();
    if(!row)return;
    row.hidden=isStandalone();
    const small=row.querySelector('small');
    if(small){
      small.textContent=isIos()
        ?'Use Share → Add to Home Screen to install FreshWay.'
        :'Use your browser menu → Install app or Add to Home screen.';
    }
  };

  const showInstallHelp=()=>{
    if(isStandalone()||installNudgeShown)return;
    installNudgeShown=true;
    markNudgeSeen();

    const modal=document.createElement('div');
    modal.className='modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','pwaInstallHelpTitle');
    const instruction=isIos()
      ?'In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.'
      :'Tap the browser menu <strong>⋮</strong>, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.';
    modal.innerHTML='<div class="modal-sheet pwa-help"><div class="modal-head"><div><span class="eyebrow">FRESHWAY APP</span><h2 id="pwaInstallHelpTitle">Install FreshWay</h2></div><button class="icon-btn" type="button" aria-label="Close">×</button></div><p>'+instruction+'</p><button class="primary-btn full pwa-install-action" type="button">Got it</button><button class="secondary-btn full pwa-install-later" type="button">Not now</button></div>';

    const close=()=>{
      modal.remove();
      installNudgeShown=false;
    };

    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    modal.querySelector('.icon-btn').addEventListener('click',close);
    modal.querySelector('.pwa-install-later').addEventListener('click',close);
    modal.querySelector('.pwa-install-action').addEventListener('click',close);

    document.body.appendChild(modal);
  };

  const registerServiceWorker=async()=>{
    if(!('serviceWorker' in navigator))return null;
    try{
      return await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    }catch(_){
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
    row.addEventListener('click',showInstallHelp);
    const notifications=document.querySelector('#enableNotifications');
    if(notifications?.parentNode===menu)menu.insertBefore(row,notifications);else menu.appendChild(row);
    setAvailable();
  };

  const scheduleInstallNudge=()=>{
    if(isStandalone()||nudgeSeen())return;
    window.setTimeout(()=>{
      if(!isStandalone()&&!nudgeSeen())showInstallHelp();
    },3000);
  };

  const init=()=>{
    addRow();
    const register=()=>{void registerServiceWorker()};
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
    window.addEventListener('appinstalled',()=>{
      const row=getRow();
      if(row)row.hidden=true;
      installNudgeShown=false;
    });
    window.addEventListener('pageshow',()=>{
      addRow();
      setAvailable();
    });
    scheduleInstallNudge();
  };

  return{init,showInstallHelp};
})();

window.FreshWayPwaInstall=FreshWayPwaInstall;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPwaInstall.init(),{once:true});else FreshWayPwaInstall.init();
