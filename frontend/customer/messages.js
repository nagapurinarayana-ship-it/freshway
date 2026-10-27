(function(){
  const root=()=>document.querySelector('#customerMessagesContent');
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const api=()=>window.FreshWayCustomerAPI?.request;
  const auth=()=>window.FreshWayCustomerAuth;
  const niceDate=value=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value).slice(0,16):d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});};
  let busy=false;
  function setBadge(count){
    const label=document.querySelector('#customerMessagesStatus');
    if(label)label.textContent=count>0?count+' new repl'+(count===1?'y':'ies')+' from FreshWay':'View messages and replies';
    const button=document.querySelector('[data-nav="messages"]');
    if(button){button.classList.toggle('has-unread-messages',count>0);button.setAttribute('aria-label',count>0?'Messages, '+count+' unread replies':'Messages');}
  }
  async function refreshBadge(){
    if(!auth()?.customerId?.()){setBadge(0);return 0;}
    try{const fn=api();if(!fn)return 0;const data=await fn('/api/customer/messages/unread-count');const count=Math.max(0,Number(data.unreadCount)||0);setBadge(count);return count;}catch(_){return 0;}
  }
  function render(messages){
    const el=root();if(!el)return;
    if(!messages.length){el.innerHTML='<div class="empty"><div style="font-size:36px">✉️</div><strong>No messages yet</strong><p>Contact FreshWay if you need help. Replies will appear here.</p><button class="primary-btn" type="button" data-messages-contact>Contact FreshWay</button></div>';return;}
    el.innerHTML='<div class="fw-customer-messages-intro"><p>Messages and replies from FreshWay appear here. We keep messages for up to 90 days.</p><button class="text-btn" type="button" data-messages-contact>Contact FreshWay</button></div>'+messages.map(m=>{
      const unread=m.status==='replied'&&!m.reply_seen_at;
      return '<article class="fw-customer-message'+(unread?' is-unread':'')+'"><div class="fw-customer-message-head"><div><strong>'+esc(m.subject||'Message to FreshWay')+'</strong><small>Sent '+esc(niceDate(m.created_at))+'</small></div><span class="fw-customer-message-status '+(m.status==='replied'?'is-replied':'is-pending')+'">'+(unread?'New reply':m.status==='replied'?'Replied':'Awaiting reply')+'</span></div><p class="fw-customer-message-body">'+esc(m.message)+'</p>'+(m.admin_reply?'<div class="fw-customer-message-reply"><strong>FreshWay replied</strong><small>'+esc(niceDate(m.replied_at))+'</small><p>'+esc(m.admin_reply)+'</p></div>':'<p class="fw-customer-message-waiting">We’ll show the reply here when it’s ready.</p>')+'</article>';
    }).join('');
  }
  async function load(){
    const el=root();if(!el||busy)return;
    busy=true;el.innerHTML='<p class="muted">Loading your messages…</p>';
    try{
      const fn=api();if(!fn)throw new Error('Messages are temporarily unavailable.');
      const data=await fn('/api/customer/messages');
      const messages=Array.isArray(data.messages)?data.messages:[];
      render(messages);
      const unread=messages.some(m=>m.status==='replied'&&!m.reply_seen_at);
      if(unread){await fn('/api/customer/messages/read',{method:'PATCH',body:JSON.stringify({})});}
      await refreshBadge();
    }catch(error){
      if(Number(error?.status)===401||error?.code==='AUTHENTICATION_REQUIRED'){
        el.innerHTML='<div class="empty"><div style="font-size:36px">🔐</div><strong>Sign in to view your messages</strong><p>Your replies are private and linked to your FreshWay account.</p><button class="primary-btn" type="button" data-messages-sign-in>Sign in</button></div>';
      }else{
        el.innerHTML='<div class="empty"><strong>Could not load messages</strong><p>'+esc(error.message||'Please try again.')+'</p><button class="secondary-btn" type="button" data-messages-refresh>Try again</button></div>';
      }
    }finally{busy=false;}
  }
  async function signIn(){
    try{await auth()?.login?.();await load();await refreshBadge();}
    catch(error){if(!/cancel/i.test(error?.message||''))window.FreshWayCustomerFeedback?.show?.(document,error.message||'Could not sign in.');}
  }
  document.addEventListener('click',event=>{
    const signInButton=event.target.closest('[data-messages-sign-in]');
    if(signInButton){event.preventDefault();void signIn();return;}
    if(event.target.closest('[data-messages-refresh]')){void load();return;}
    if(event.target.closest('[data-messages-contact]')){window.setView?.('contact');}
  });
  document.addEventListener('freshway:session',()=>{void refreshBadge();});
  document.addEventListener('freshway:session-expired',()=>{setBadge(0);});
  window.FreshWayCustomerMessages=Object.freeze({load,refreshBadge,refreshBadgeCount:refreshBadge});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void refreshBadge(),{once:true});else void refreshBadge();
})();
