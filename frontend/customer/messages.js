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
    if(button)button.classList.toggle('has-unread-messages',count>0);
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
      return '<article class="fw-customer-message'+(unread?' is-unread':'')+'" data-customer-message-id="'+esc(m.id)+'"><div class="fw-customer-message-head"><div><strong>'+esc(m.subject||'Message to FreshWay')+'</strong><small>Sent '+esc(niceDate(m.created_at))+'</small>'+(m.order_id?'<small>About order '+esc(m.order_id)+'</small>':'')+'</div><span class="fw-customer-message-status '+(m.status==='replied'?'is-replied':'is-pending')+'">'+(unread?'New reply':m.status==='replied'?'Replied':'Awaiting reply')+'</span></div><p class="fw-customer-message-body">'+esc(m.message)+'</p>'+(m.admin_reply?'<div class="fw-customer-message-reply"><strong>FreshWay replied</strong><small>'+esc(niceDate(m.replied_at))+'</small><p>'+esc(m.admin_reply)+'</p></div>':'<p class="fw-customer-message-waiting">We’ll show the reply here when it’s ready.</p>')+'</article>';
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
      if(unread){await fn('/api/customer/messages/read',{method:'PATCH',body:JSON.stringify({})});messages.forEach(message=>{if(message.status==='replied'&&!message.reply_seen_at)message.reply_seen_at=new Date().toISOString();});render(messages);}
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
  const style=document.createElement('style');
  style.textContent='.fw-customer-messages-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:4px 0 14px}.fw-customer-messages-intro p{color:#647168;margin:0}.fw-customer-message{background:#fff;border:1px solid #e1e9e4;border-radius:16px;padding:16px;margin:12px 0}.fw-customer-message.is-unread{border-color:#16834f;box-shadow:0 0 0 1px rgba(22,131,79,.08)}.fw-customer-message-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.fw-customer-message-head strong,.fw-customer-message-head small{display:block}.fw-customer-message-head small,.fw-customer-message-reply small{color:#6c786f;margin-top:4px}.fw-customer-message-status{white-space:nowrap;font-size:.78rem;border-radius:999px;padding:5px 9px;background:#f2f4f2;color:#5d6a61}.fw-customer-message-status.is-replied{background:#e6f6ed;color:#176b43}.fw-customer-message-status.is-pending{background:#fff4df;color:#8a5b00}.fw-customer-message-body,.fw-customer-message-reply p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}.fw-customer-message-reply{background:#f2f8f4;border-radius:12px;padding:12px;margin-top:14px}.fw-customer-message-reply p{margin-bottom:0}.fw-customer-message-waiting{color:#647168;font-size:.92rem}.has-unread-messages #customerMessagesStatus{font-weight:700;color:#176b43}';
  document.head.appendChild(style);
  function openMessageFromNotification(){
    const incoming=new URL(location.href),messageId=incoming.searchParams.get('openMessage');
    if(!messageId&&location.hash!=='#messages')return;
    if(!window.setView)return;
    window.setView('messages',{history:'replace'});
    if(!messageId)return;
    const container=root();if(!container)return;
    const finish=card=>{
      observer.disconnect();
      card?.scrollIntoView({behavior:'smooth',block:'center'});
      const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete('openMessage');cleanUrl.hash='messages';
      history.replaceState({__freshwayCustomer:true,view:'messages'},'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    };
    const findCard=()=>[...container.querySelectorAll('[data-customer-message-id]')].find(item=>item.dataset.customerMessageId===messageId);
    const observer=new MutationObserver(()=>{
      const card=findCard();
      if(card){finish(card);return;}
      if(!container.textContent.includes('Loading your messages'))finish(null);
    });
    observer.observe(container,{childList:true,subtree:true});
    const existing=findCard();if(existing)finish(existing);
  }
  window.FreshWayCustomerMessages=Object.freeze({load,refreshBadge,refreshBadgeCount:refreshBadge});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void refreshBadge();openMessageFromNotification();},{once:true});else {void refreshBadge();openMessageFromNotification();}
})();
