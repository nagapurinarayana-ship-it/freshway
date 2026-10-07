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
    if(small)small.textContent=available?'Install FreshWay on this device for faster access.':isIos()?'Use Share → Add to Home Screen to install FreshWay.':'Use your browser menu → Install app / Add to Home screen.';
  };
  const showIosHelp=()=>{
    const modal=document.createElement('div');
    modal.className='modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.innerHTML='<div class="modal-sheet pwa-help"><div class="modal-head"><div><span class="eyebrow">INSTALL FRESHWAY</span><h2>Add FreshWay to your phone</h2></div><button class="icon-btn" type="button" aria-label="Close">×</button></div><p>In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>. FreshWay will appear like an app on your home screen.</p><button class="primary-btn full" type="button">Got it</button></div>';
    const close=()=>modal.remove();
    modal.querySelector('.icon-btn').addEventListener('click',close);
    modal.querySelector('.primary-btn').addEventListener('click',close);
    document.body.appendChild(modal);
  };
  const install=async()=>{
    if(isStandalone())return;
    if(deferredPrompt){
      const prompt=deferredPrompt;
      deferredPrompt=null;
      prompt.prompt();
      try{await prompt.userChoice}catch(_){ }
      setAvailable(false);
      return;
    }
    if(isIos())showIosHelp();
    else alert('Open your browser menu and choose “Install app” or “Add to Home screen”.');
  };
  const addRow=()=>{
    const menu=document.querySelector('.menu-card');
    if(!menu||document.querySelector('#pwaInstallRow'))return;
    const row=document.createElement('button');
    row.id='pwaInstallRow';
    row.className='pwa-install-row';
    row.type='button';
    row.innerHTML='<span aria-hidden="true">⬇</span><div><strong>Install FreshWay</strong><small>Install FreshWay on this device for faster access.</small></div><b>›</b>';
    row.addEventListener('click',install);
    const notifications=document.querySelector('#enableNotifications');
    if(notifications?.parentNode===menu)menu.insertBefore(row,notifications);else menu.appendChild(row);
    setAvailable(Boolean(deferredPrompt));
  };
  const init=()=>{
    addRow();
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;addRow();setAvailable(true)});
    window.addEventListener('appinstalled',()=>{deferredPrompt=null;const row=getRow();if(row)row.hidden=true});
    window.addEventListener('pageshow',()=>{addRow();setAvailable(Boolean(deferredPrompt))});
  };
  return{init,install};
})();
window.FreshWayPwaInstall=FreshWayPwaInstall;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPwaInstall.init(),{once:true});else FreshWayPwaInstall.init();
