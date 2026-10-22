const FreshWayNotifications=(()=>{const CUSTOMER_KEY='freshway-customer-id',STATE_KEY='freshway-state-v2';let busy=false,sessionCheckTimer=null,registeredPhoneValue='',registeredNameValue='';const id=()=>String(localStorage.getItem(CUSTOMER_KEY)||'').trim()||null,normalizeAuthPhone=value=>{const digits=String(value||'').replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits},setCustomerId=v=>{const x=String(v||'').trim();if(x)localStorage.setItem(CUSTOMER_KEY,x)},clearCustomerId=()=>{localStorage.removeItem(CUSTOMER_KEY);registeredPhoneValue='';registeredNameValue=''};const clearLocal=()=>{try{const s=JSON.parse(localStorage.getItem(STATE_KEY)||'{}');s.orders=[];s.profile={address:'',checkout:{}};delete s.profile.pendingCheckout;localStorage.setItem(STATE_KEY,JSON.stringify(s))}catch(_){localStorage.removeItem(STATE_KEY)}};const api=async(path,options={})=>{const r=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options}),t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={}}if(!r.ok){const e=new Error(d.error||t||`HTTP ${r.status}`);e.status=r.status;throw e}return d};const session=async()=>{const current=await api('/api/auth/session',{method:'GET'});registeredPhoneValue=normalizeAuthPhone(current?.registeredPhone||'');registeredNameValue=String(current?.name||'').trim();return current};function ensureModal(){
  let el=document.querySelector('#customerAuthModal');
  if(el)return el;
  el=document.createElement('div');
  el.id='customerAuthModal';
  el.className='modal hidden';
  el.setAttribute('role','dialog');
  el.setAttribute('aria-modal','true');
  el.setAttribute('aria-labelledby','customerAuthTitle');
  el.innerHTML='<div class="modal-sheet">'+
    '<div class="modal-head"><div><span class="eyebrow">FRESHWAY ACCOUNT</span><h2 id="customerAuthTitle">Continue with WhatsApp</h2></div><button id="otpCancel" class="icon-btn" aria-label="Close">×</button></div>'+
    '<p id="otpHint" class="muted">Enter your mobile number and we will send a one-time verification code on WhatsApp.</p>'+
    '<label>Mobile number<input id="otpPhone" inputmode="tel" maxlength="15" pattern="[0-9]{10}" autocomplete="tel" placeholder="10-digit mobile number" required></label>'+
    '<label id="otpNameWrap" class="hidden">Your name<input id="otpName" maxlength="120" autocomplete="name" placeholder="Enter your name"></label>'+
    '<label id="otpCodeWrap" class="hidden">WhatsApp verification code<input id="otpCode" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" placeholder="6-digit code"></label>'+
    '<div id="otpError" class="otp-error hidden" role="alert"></div>'+
    '<button id="otpSubmit" class="primary-btn full" type="button">Send WhatsApp code</button>'+
    '<div class="owner-alert-control-actions"><button id="otpResend" class="secondary-btn full hidden" type="button">Resend code</button><button id="otpChange" class="secondary-btn full hidden" type="button">Change number</button></div>'+
    '<p class="otp-footnote">No password needed. By continuing, you agree to receive a one-time FreshWay verification message on WhatsApp. Never share your code with anyone.</p>'+
    '</div>';
  document.body.appendChild(el);
  return el;
}
function openAuth(phone){
  const el=ensureModal();
  const phoneEl=el.querySelector('#otpPhone');
  const nameEl=el.querySelector('#otpName');
  const nameWrap=el.querySelector('#otpNameWrap');
  const codeEl=el.querySelector('#otpCode');
  const codeWrap=el.querySelector('#otpCodeWrap');
  const submit=el.querySelector('#otpSubmit');
  const resend=el.querySelector('#otpResend');
  const change=el.querySelector('#otpChange');
  const cancel=el.querySelector('#otpCancel');
  const hint=el.querySelector('#otpHint');
  const err=el.querySelector('#otpError');
  let stage='phone',challengeId='',settled=false,needsName=false;
  phoneEl.value=normalizeAuthPhone(phone);
  nameEl.value='';codeEl.value='';
  const showError=message=>{err.textContent=message||'';err.classList.toggle('hidden',!message)};
  const render=()=>{
    const verifying=stage==='verify';
    phoneEl.disabled=verifying;
    codeWrap.classList.toggle('hidden',!verifying);
    nameWrap.classList.toggle('hidden',!needsName);
    resend.classList.toggle('hidden',!verifying);
    change.classList.toggle('hidden',!verifying);
    submit.textContent=verifying?(needsName?'Create account & continue':'Verify & continue'):'Send WhatsApp code';
  };
  el.classList.remove('hidden');
  render();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{
      submit.removeEventListener('click',go);
      resend.removeEventListener('click',resendCode);
      change.removeEventListener('click',changeNumber);
      cancel.removeEventListener('click',close);
      phoneEl.removeEventListener('blur',normalizePhoneOnBlur);
      el.classList.add('hidden');
      phoneEl.disabled=false;
    };
    const finish=(ok,value)=>{if(settled)return;settled=true;cleanup();ok?resolve(value):reject(value)};
    const normalizePhoneOnBlur=()=>{phoneEl.value=normalizeAuthPhone(phoneEl.value)};
    const close=()=>finish(false,new Error('Account sign-in was cancelled.'));
    const changeNumber=()=>{
      stage='phone';challengeId='';needsName=false;codeEl.value='';nameEl.value='';
      phoneEl.disabled=false;showError('');hint.textContent='Enter your mobile number and we will send a one-time verification code on WhatsApp.';
      render();phoneEl.focus();
    };
    const requestCode=async(isResend=false)=>{
      const p=normalizeAuthPhone(phoneEl.value);phoneEl.value=p;
      if(!/^\d{10}$/.test(p)){showError('Enter a valid 10-digit mobile number.');phoneEl.focus();return}
      busy=true;submit.disabled=true;resend.disabled=true;showError('');
      try{
        const result=await api('/api/auth/otp/start',{method:'POST',body:JSON.stringify({phone:p})});
        challengeId=String(result.challengeId||'');
        if(!challengeId)throw new Error('Could not start verification. Please try again.');
        stage='verify';needsName=false;codeEl.value='';render();
        hint.textContent=isResend?'A new code has been sent on WhatsApp.':'Check WhatsApp for your 6-digit verification code.';
        codeEl.focus();
      }catch(error){showError(error.message||'Could not send a WhatsApp code. Please try again.')}
      finally{busy=false;submit.disabled=false;resend.disabled=false}
    };
    const resendCode=()=>{if(!busy)requestCode(true)};
    const go=async()=>{
      if(busy)return;
      if(stage==='phone'){await requestCode(false);return}
      const p=normalizeAuthPhone(phoneEl.value),code=codeEl.value.trim(),name=nameEl.value.trim();
      if(!/^\d{10}$/.test(p)){showError('Enter a valid 10-digit mobile number.');phoneEl.focus();return}
      if(!/^\d{6}$/.test(code)){showError('Enter the 6-digit WhatsApp verification code.');codeEl.focus();return}
      if(needsName&&!name){showError('Enter your name to create your FreshWay account.');nameEl.focus();return}
      busy=true;submit.disabled=true;resend.disabled=true;showError('');
      try{
        const result=await api('/api/auth/otp/verify',{method:'POST',body:JSON.stringify({phone:p,challengeId,code,name})});
        if(result.needsName){
          needsName=true;render();hint.textContent='Your number is verified. Enter your name to finish creating your account.';
          nameEl.focus();return;
        }
        if(!result.customerId)throw new Error('Could not create your customer session. Please try again.');
        registeredPhoneValue=normalizeAuthPhone(result.registeredPhone||p);
        registeredNameValue=String(result.name||name||'').trim();
        setCustomerId(result.customerId);
        finish(true,result.customerId);
        document.dispatchEvent(new CustomEvent('freshway:session'));
      }catch(error){showError(error.message||'Could not verify the WhatsApp code. Please try again.')}
      finally{busy=false;submit.disabled=false;resend.disabled=false}
    };
    submit.addEventListener('click',go);
    resend.addEventListener('click',resendCode);
    change.addEventListener('click',changeNumber);
    cancel.addEventListener('click',close);
    phoneEl.addEventListener('blur',normalizePhoneOnBlur);
    setTimeout(()=>phoneEl.value?phoneEl.focus():phoneEl.focus(),30);
  });
}
async function ensureAuthenticated(phone){try{const current=await session();if(current?.customerId){setCustomerId(current.customerId);return current.customerId}}catch(_){}const normalized=normalizeAuthPhone(phone);if(normalized&&!/^\d{10}$/.test(normalized))throw new Error('Enter a valid 10-digit mobile number.');return openAuth(normalized)}const login=()=>openAuth('');const keyBytes=key=>{if(!key||typeof key!=='string')throw new Error('Push notifications are not configured on FreshWay yet.');const pad='='.repeat((4-key.length%4)%4),raw=atob((key+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))};async function enable(){if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error('Push notifications are not supported by this browser.');let current;try{current=await session()}catch(_){current=null}if(!current?.customerId)throw new Error('Log in with your mobile number and WhatsApp OTP first.');setCustomerId(current.customerId);const reg=await navigator.serviceWorker.register('/sw.js'),permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission was not granted.');const{publicKey}=await api('/api/push/public-key'),existing=await reg.pushManager.getSubscription(),subscription=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});await api('/api/push/subscribe',{method:'POST',body:JSON.stringify({customerId:current.customerId,subscription:subscription.toJSON()})});localStorage.setItem('freshway-push-enabled','1');return true}async function registerCustomer(name,phone,whatsappOptIn=false){try{await api('/api/customers/register',{method:'POST',body:JSON.stringify({id:id(),name,phone,whatsappOptIn})});return true}catch(e){console.warn('FreshWay profile update failed:',e);return false}}async function logout(){try{await api('/api/auth/logout',{method:'POST'})}finally{clearCustomerId();localStorage.removeItem('freshway-push-enabled');clearLocal();document.dispatchEvent(new CustomEvent('freshway:logout'))}}async function validateSession(){try{const c=await session();if(c?.customerId){setCustomerId(c.customerId);return c.customerId}}catch(_){}clearCustomerId();clearLocal();document.dispatchEvent(new CustomEvent('freshway:session-expired'));return null}function addLoginButton(){const row=document.querySelector('#signOutBtn');if(!row||document.querySelector('#customerLoginBtn'))return;const b=document.createElement('button');b.id='customerLoginBtn';b.className='signout-row';b.innerHTML='<span>↪</span><div><strong>Log in</strong><small>Continue securely with WhatsApp OTP</small></div><b>›</b>';b.addEventListener('click',()=>login().catch(()=>{}));row.parentNode.insertBefore(b,row)}async function init(){if('serviceWorker'in navigator)await navigator.serviceWorker.register('/sw.js').catch(()=>{});addLoginButton();await validateSession();clearInterval(sessionCheckTimer);sessionCheckTimer=setInterval(()=>validateSession().catch(()=>{}),300000);document.addEventListener('freshway:logout',()=>window.location.reload());document.addEventListener('freshway:session',()=>{const b=document.querySelector('#customerLoginBtn');if(b)b.style.display=id()?'none':''});document.dispatchEvent(new CustomEvent('freshway:session'))}return{init,enable,registerCustomer,ensureAuthenticated,login,session,logout,customerId:id,registeredPhone:()=>registeredPhoneValue,registeredName:()=>registeredNameValue,setCustomerId,clearCustomerId,closeOtp:()=>document.querySelector('#customerAuthModal')?.classList.add('hidden'),validateSession}})();window.FreshWayNotifications=FreshWayNotifications;FreshWayNotifications.init();