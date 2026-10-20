const FreshWayNotifications=(()=>{const CUSTOMER_KEY='freshway-customer-id',STATE_KEY='freshway-state-v2';let busy=false,sessionCheckTimer=null,registeredPhoneValue='',registeredNameValue='';const id=()=>String(localStorage.getItem(CUSTOMER_KEY)||'').trim()||null,normalizeAuthPhone=value=>{const digits=String(value||'').replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits},setCustomerId=v=>{const x=String(v||'').trim();if(x)localStorage.setItem(CUSTOMER_KEY,x)},clearCustomerId=()=>{localStorage.removeItem(CUSTOMER_KEY);registeredPhoneValue='';registeredNameValue=''};const clearLocal=()=>{try{const s=JSON.parse(localStorage.getItem(STATE_KEY)||'{}');s.orders=[];s.profile={address:'',checkout:{}};delete s.profile.pendingCheckout;localStorage.setItem(STATE_KEY,JSON.stringify(s))}catch(_){localStorage.removeItem(STATE_KEY)}};const api=async(path,options={})=>{const r=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options}),t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={}}if(!r.ok){const e=new Error(d.error||t||`HTTP ${r.status}`);e.status=r.status;throw e}return d};const session=async()=>{const current=await api('/api/auth/session',{method:'GET'});registeredPhoneValue=normalizeAuthPhone(current?.registeredPhone||'');registeredNameValue=String(current?.name||'').trim();return current};function ensureModal(){
  let el=document.querySelector('#passcodeModal');
  if(el)return el;
  el=document.createElement('div');
  el.id='passcodeModal';
  el.className='modal hidden';
  el.setAttribute('role','dialog');
  el.setAttribute('aria-modal','true');
  el.innerHTML='<div class="modal-sheet">'+
    '<div class="modal-head"><div><span class="eyebrow">FRESHWAY ACCOUNT</span><h2>Mobile login</h2></div><button id="passcodeCancel" class="icon-btn" aria-label="Close">×</button></div>'+
    '<p id="passcodeHint" class="muted">Use your registered mobile number and 6-digit passcode.</p>'+
    '<label id="passcodeNameWrap" class="hidden">Your name<input id="passcodeName" maxlength="120" autocomplete="name" placeholder="Enter your name"></label>'+
    '<label>Registered mobile number<input id="passcodePhone" inputmode="tel" maxlength="15" pattern="[0-9]{10}" autocomplete="tel"></label>'+
    '<label id="passcodeValueWrap">6-digit passcode<input id="passcodeValue" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="current-password" type="password" placeholder="6 digits"></label>'+
    '<label id="passcodeConfirmWrap" class="hidden">Confirm passcode<input id="passcodeConfirm" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" type="password" autocomplete="new-password" placeholder="Enter again"></label>'+
    '<label id="passcodeResetCodeWrap" class="hidden">SMS verification code<input id="passcodeResetCode" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" placeholder="6-digit code"></label>'+
    '<label id="passcodeResetNewWrap" class="hidden">New 6-digit passcode<input id="passcodeResetNew" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="new-password" type="password" placeholder="Choose a new passcode"></label>'+
    '<label id="passcodeResetConfirmWrap" class="hidden">Confirm new passcode<input id="passcodeResetConfirm" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="new-password" type="password" placeholder="Enter it again"></label>'+
    '<div id="passcodeError" class="otp-error hidden" role="alert"></div>'+
    '<button id="passcodeSubmit" class="primary-btn full" type="button">Login</button>'+
    '<button id="passcodeForgot" class="secondary-btn full" type="button">Forgot passcode?</button>'+
    '<button id="passcodeMode" class="secondary-btn full" type="button">New customer? Create account</button>'+
    '<p class="otp-footnote">Your passcode is protected. Your account mobile identifies your orders; the delivery contact can be different for each order.</p>'+
    '</div>';
  document.body.appendChild(el);
  return el;
}
function openAuth(phone){
  const el=ensureModal();
  const nameEl=el.querySelector('#passcodeName');
  const nameWrap=el.querySelector('#passcodeNameWrap');
  const phoneEl=el.querySelector('#passcodePhone');
  const passEl=el.querySelector('#passcodeValue');
  const passWrap=el.querySelector('#passcodeValueWrap');
  const confirmEl=el.querySelector('#passcodeConfirm');
  const confirmWrap=el.querySelector('#passcodeConfirmWrap');
  const resetCode=el.querySelector('#passcodeResetCode');
  const resetCodeWrap=el.querySelector('#passcodeResetCodeWrap');
  const resetNew=el.querySelector('#passcodeResetNew');
  const resetNewWrap=el.querySelector('#passcodeResetNewWrap');
  const resetConfirm=el.querySelector('#passcodeResetConfirm');
  const resetConfirmWrap=el.querySelector('#passcodeResetConfirmWrap');
  const submit=el.querySelector('#passcodeSubmit');
  const modeButton=el.querySelector('#passcodeMode');
  const forgotButton=el.querySelector('#passcodeForgot');
  const cancel=el.querySelector('#passcodeCancel');
  const hint=el.querySelector('#passcodeHint');
  const err=el.querySelector('#passcodeError');
  let mode='login',codeSent=false,settled=false;
  phoneEl.value=normalizeAuthPhone(phone);
  nameEl.value='';passEl.value='';confirmEl.value='';resetCode.value='';resetNew.value='';resetConfirm.value='';
  registeredPhoneValue=registeredPhoneValue||'';
  const showError=message=>{err.textContent=message||'';err.classList.toggle('hidden',!message)};
  const render=()=>{
    const registerMode=mode==='register',resetMode=mode==='forgot';
    nameWrap.classList.toggle('hidden',!registerMode);
    confirmWrap.classList.toggle('hidden',!registerMode);
    passWrap.classList.toggle('hidden',resetMode);
    resetCodeWrap.classList.toggle('hidden',!resetMode||!codeSent);
    resetNewWrap.classList.toggle('hidden',!resetMode||!codeSent);
    resetConfirmWrap.classList.toggle('hidden',!resetMode||!codeSent);
    forgotButton.classList.toggle('hidden',mode!=='login');
    modeButton.textContent=registerMode?'Already registered? Login':resetMode?'Back to login':'New customer? Create account';
    modeButton.textContent=resetMode?'Back to login':modeButton.textContent;
    
    submit.textContent=resetMode?(codeSent?'Reset passcode':'Send verification code'):registerMode?'Create account':'Login';
    hint.textContent=resetMode
      ? (codeSent?'Enter the SMS code and choose a new 6-digit passcode.':'We will send a verification code to your registered mobile if the account exists.')
      : registerMode?'Create one account with your mobile number and a personal 6-digit passcode.':'Use the mobile number you registered with FreshWay.';
    phoneEl.disabled=resetMode&&codeSent;
  };
  render();
  el.classList.remove('hidden');
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{
      submit.removeEventListener('click',go);
      modeButton.removeEventListener('click',toggle);
      forgotButton.removeEventListener('click',forgot);
      cancel.removeEventListener('click',close);
      phoneEl.removeEventListener('blur',normalizePhoneOnBlur);
      el.classList.add('hidden');
      phoneEl.disabled=false;
    };
    const finish=(ok,value)=>{if(settled)return;settled=true;cleanup();ok?resolve(value):reject(value)};
    const normalizePhoneOnBlur=()=>{phoneEl.value=normalizeAuthPhone(phoneEl.value)};
    const toggle=()=>{
      showError('');
      codeSent=false;
      phoneEl.disabled=false;
      mode=mode==='register'||mode==='forgot'?'login':'register';
      passEl.value='';confirmEl.value='';resetCode.value='';resetNew.value='';resetConfirm.value='';
      render();passEl.focus();
    };
    const forgot=()=>{
      showError('');
      mode='forgot';codeSent=false;passEl.value='';confirmEl.value='';resetCode.value='';resetNew.value='';resetConfirm.value='';
      render();phoneEl.focus();
    };
    const close=()=>finish(false,new Error('Account sign-in was cancelled.'));
    const go=async()=>{
      if(busy)return;
      const name=nameEl.value.trim(),p=normalizeAuthPhone(phoneEl.value),pass=passEl.value;
      phoneEl.value=p;
      if(!/^\d{10}$/.test(p)){showError('Enter a valid 10-digit mobile number.');phoneEl.focus();return}
      if(mode==='forgot'){
        if(!codeSent){
          busy=true;submit.disabled=true;showError('');
          try{
            await api('/api/auth/passcode-reset/start',{method:'POST',body:JSON.stringify({phone:p})});
            codeSent=true;render();
            showError('');
            hint.textContent='If this mobile is registered, a verification code has been sent. Check SMS.';
            resetCode.focus();
          }catch(error){showError(error.message||'Could not start passcode recovery. Please try again.')}
          finally{busy=false;submit.disabled=false}
          return;
        }
        const code=resetCode.value.trim(),newPass=resetNew.value,newConfirm=resetConfirm.value;
        if(!/^\d{6}$/.test(code)){showError('Enter the 6-digit SMS verification code.');resetCode.focus();return}
        if(!/^\d{6}$/.test(newPass)){showError('Your new passcode must be exactly 6 digits.');resetNew.focus();return}
        if(newConfirm!==newPass){showError('The new passcodes do not match.');resetConfirm.focus();return}
        busy=true;submit.disabled=true;showError('');
        try{
          const result=await api('/api/auth/passcode-reset/complete',{method:'POST',body:JSON.stringify({phone:p,code,passcode:newPass})});
          if(!result.customerId)throw new Error('Could not restore your customer session.');
          registeredPhoneValue=normalizeAuthPhone(result.registeredPhone||p);
          registeredNameValue=String(result.name||'').trim();
          setCustomerId(result.customerId);
          finish(true,result.customerId);
          document.dispatchEvent(new CustomEvent('freshway:session'));
        }catch(error){showError(error.message||'Could not reset your passcode. Please try again.')}
        finally{busy=false;submit.disabled=false}
        return;
      }
      if(mode==='register'&&!name){showError('Enter your name.');nameEl.focus();return}
      if(!/^\d{6}$/.test(pass)){showError('Passcode must be exactly 6 digits.');passEl.focus();return}
      if(mode==='register'&&confirmEl.value!==pass){showError('Passcodes do not match.');confirmEl.focus();return}
      busy=true;submit.disabled=true;showError('');
      try{
        const result=await api(mode==='register'?'/api/auth/register':'/api/auth/login',{
          method:'POST',
          body:JSON.stringify(mode==='register'?{name,phone:p,passcode:pass}:{phone:p,passcode:pass})
        });
        if(!result.customerId)throw new Error('Could not create your customer session.');
        registeredPhoneValue=normalizeAuthPhone(result.registeredPhone||p);
        registeredNameValue=String(result.name||name||'').trim();
        setCustomerId(result.customerId);
        finish(true,result.customerId);
        document.dispatchEvent(new CustomEvent('freshway:session'));
      }catch(error){
        if(mode==='register'&&error.status===409){
          mode='login';render();showError('This mobile is already registered. Log in with your existing passcode, or use Forgot passcode.');
          passEl.value='';passEl.focus();
        }else if(mode==='login'&&error.status===404){
          mode='register';render();showError('This mobile is not registered. Create your account with your name and a 6-digit passcode.');
          nameEl.focus();
        }else{
          showError(error.message||'Could not sign in.');
        }
      }finally{busy=false;submit.disabled=false}
    };
    submit.addEventListener('click',go);
    modeButton.addEventListener('click',toggle);
    forgotButton.addEventListener('click',forgot);
    cancel.addEventListener('click',close);
    phoneEl.addEventListener('blur',normalizePhoneOnBlur);
    setTimeout(()=>mode==='register'&&nameEl.value===''?nameEl.focus():phoneEl.value?passEl.focus():phoneEl.focus(),30);
  });
}
async function ensureAuthenticated(phone){try{const current=await session();if(current?.customerId){setCustomerId(current.customerId);return current.customerId}}catch(_){}const normalized=normalizeAuthPhone(phone);if(normalized&&!/^\d{10}$/.test(normalized))throw new Error('Enter a valid 10-digit mobile number.');return openAuth(normalized)}const login=()=>openAuth('');const keyBytes=key=>{if(!key||typeof key!=='string')throw new Error('Push notifications are not configured on FreshWay yet.');const pad='='.repeat((4-key.length%4)%4),raw=atob((key+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))};async function enable(){if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error('Push notifications are not supported by this browser.');let current;try{current=await session()}catch(_){current=null}if(!current?.customerId)throw new Error('Log in with your mobile number and 6-digit passcode first.');setCustomerId(current.customerId);const reg=await navigator.serviceWorker.register('/sw.js'),permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission was not granted.');const{publicKey}=await api('/api/push/public-key'),existing=await reg.pushManager.getSubscription(),subscription=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify({customerId:current.customerId,subscription:subscription.toJSON()})});localStorage.setItem('freshway-push-enabled','1');return true}async function registerCustomer(name,phone,whatsappOptIn=false){try{await api('/api/customers/register',{method:'POST',body:JSON.stringify({id:id(),name,phone,whatsappOptIn})});return true}catch(e){console.warn('FreshWay profile update failed:',e);return false}}async function logout(){try{await api('/api/auth/logout',{method:'POST'})}finally{clearCustomerId();localStorage.removeItem('freshway-push-enabled');clearLocal();document.dispatchEvent(new CustomEvent('freshway:logout'))}}async function validateSession(){try{const c=await session();if(c?.customerId){setCustomerId(c.customerId);return c.customerId}}catch(_){}clearCustomerId();clearLocal();document.dispatchEvent(new CustomEvent('freshway:session-expired'));return null}function addLoginButton(){const row=document.querySelector('#signOutBtn');if(!row||document.querySelector('#customerLoginBtn'))return;const b=document.createElement('button');b.id='customerLoginBtn';b.className='signout-row';b.innerHTML='<span>↪</span><div><strong>Log in</strong><small>Mobile number + 6-digit passcode</small></div><b>›</b>';b.addEventListener('click',()=>login().catch(()=>{}));row.parentNode.insertBefore(b,row)}async function init(){if('serviceWorker'in navigator)await navigator.serviceWorker.register('/sw.js').catch(()=>{});addLoginButton();await validateSession();clearInterval(sessionCheckTimer);sessionCheckTimer=setInterval(()=>validateSession().catch(()=>{}),300000);document.addEventListener('freshway:logout',()=>window.location.reload());document.addEventListener('freshway:session',()=>{const b=document.querySelector('#customerLoginBtn');if(b)b.style.display=id()?'none':''});document.dispatchEvent(new CustomEvent('freshway:session'))}return{init,enable,registerCustomer,ensureAuthenticated,login,session,logout,customerId:id,registeredPhone:()=>registeredPhoneValue,registeredName:()=>registeredNameValue,setCustomerId,clearCustomerId,closeOtp:()=>document.querySelector('#passcodeModal')?.classList.add('hidden'),validateSession}})();window.FreshWayNotifications=FreshWayNotifications;FreshWayNotifications.init();