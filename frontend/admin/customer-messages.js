(function(){
  const root=document.querySelector('#customerMessagesManagement');
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const api=async(path,options={})=>{const response=await fetch('/api'+path,{...options,credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'Request failed.');error.status=response.status;throw error;}return data;};
  const date=value=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value).slice(0,16):d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});};
  let messages=[],filter='pending',busy=false,summary={pending:0,replied:0};
  function note(text){const el=root?.querySelector('[data-message-status]');if(el)el.textContent=text;}
  function render(){
    if(!root)return;
    const counts=summary.pending||0;
    const cards=messages.map(m=>'<article class="panel fw-request-card fw-customer-message-owner" data-message-card="'+esc(m.id)+'"><div class="section-head"><div><span class="eyebrow">'+(m.source==='order_request'?'ORDER HELP REQUEST':m.status==='replied'?'REPLIED':'NEEDS REPLY')+'</span><h3>'+esc(m.subject||'Customer message')+'</h3><p>'+esc(m.customer_name||'Customer')+' · mobile ending '+esc(m.customer_phone_last4||'—')+(m.order_id?' · Order '+esc(m.order_id):'')+'</p><small class="muted">Received '+esc(date(m.created_at))+'</small></div><span class="fw-store-state '+(m.status==='replied'?'is-active':'is-pending')+'">'+(m.status==='replied'?'Replied':'Pending')+'</span></div><div class="fw-customer-message-original"><strong>Customer message</strong><p>'+esc(m.message)+'</p></div>'+(m.admin_reply?'<div class="fw-customer-message-existing-reply"><strong>Current reply</strong><p>'+esc(m.admin_reply)+'</p><small class="muted">Sent '+esc(date(m.replied_at))+'</small></div>':'')+'<label class="fw-customer-reply-label">Reply to customer<textarea rows="4" maxlength="2000" data-message-reply-text placeholder="Write a helpful reply (max 2,000 characters)">'+esc(m.admin_reply||'')+'</textarea></label><div class="fw-store-actions"><button class="primary" type="button" data-message-reply="'+esc(m.id)+'" data-message-source="'+esc(m.source||'message')+'">'+(m.status==='replied'?'Update reply':'Send reply')+'</button>'+(m.source==='order_request'?'<button class="ghost" type="button" data-message-open-order="'+esc(m.order_id)+'">View order</button>':'<button class="ghost" type="button" data-message-delete="'+esc(m.id)+'">Delete message</button>')+'</div></article>').join('');
    root.innerHTML='<div class="fw-admin-section-head"><div><span class="eyebrow">CUSTOMER CARE</span><h2>Customer messages</h2><p>Reply here. Customers see your reply under Profile → Messages. A push notification is sent when their device has notifications enabled.</p></div><button class="ghost" type="button" data-message-refresh>Refresh</button></div><div class="fw-message-filters"><button type="button" class="'+(filter==='pending'?'primary':'ghost')+'" data-message-filter="pending">Needs reply ('+counts+')</button><button type="button" class="'+(filter==='all'?'primary':'ghost')+'" data-message-filter="all">All messages</button><button type="button" class="'+(filter==='replied'?'primary':'ghost')+'" data-message-filter="replied">Replied ('+(summary.replied||0)+')</button></div><p class="muted fw-admin-status" data-message-status role="status" aria-live="polite">'+messages.length+' message'+(messages.length===1?'':'s')+' shown. Messages expire after 90 days; deleting removes the message and its associated in-app reply notification.</p><div class="fw-message-list">'+(cards||'<section class="panel"><h3>No '+(filter==='pending'?'messages waiting for a reply':filter==='replied'?'replies yet':'messages')+'</h3><p class="muted">New messages from Contact Us will appear here.</p></section>')+'</div>';
  }
  async function load(){
    if(!root||busy)return;busy=true;root.innerHTML='<p class="muted">Loading customer messages…</p>';
    try{const data=await api('/admin/customer-messages?status='+encodeURIComponent(filter));messages=Array.isArray(data.messages)?data.messages:[];summary=data.summary||summary;render();}
    catch(error){root.innerHTML='<section class="panel"><h2>Could not load customer messages</h2><p class="muted">'+esc(error.message)+'</p><button class="primary" type="button" data-message-refresh>Try again</button></section>';}
    finally{busy=false;}
  }
  root?.addEventListener('click',async event=>{
    const filterButton=event.target.closest('[data-message-filter]');
    if(filterButton){filter=filterButton.dataset.messageFilter;await load();return;}
    if(event.target.closest('[data-message-refresh]')){await load();return;}
    const replyButton=event.target.closest('[data-message-reply]');
    if(replyButton){
      const card=replyButton.closest('[data-message-card]'),textarea=card?.querySelector('[data-message-reply-text]'),reply=String(textarea?.value||'').trim();
      if(reply.length<2){note('Write a reply with at least 2 characters.');textarea?.focus();return;}
      if(reply.length>2000){note('Reply must be 2,000 characters or fewer.');return;}
      replyButton.disabled=true;
      try{const replyPath=replyButton.dataset.messageSource==='order_request'?'/admin/customer-messages/order-requests/'+encodeURIComponent(replyButton.dataset.messageReply)+'/reply':'/admin/customer-messages/'+encodeURIComponent(replyButton.dataset.messageReply)+'/reply';const result=await api(replyPath,{method:'PATCH',body:JSON.stringify({reply})});if(filter==='pending')filter='replied';await load();note(result.unchanged?'This reply is already saved.':'Reply saved. '+(result.notification?.sent?'Push notification sent.':'The reply is available in the customer Messages screen; push may be unavailable on this device.'));}
      catch(error){note(error.message||'Could not save the reply.');replyButton.disabled=false;}
      return;
    }
    const openOrderButton=event.target.closest('[data-message-open-order]');
    if(openOrderButton){
      if(window.navigateAdminScreen)window.navigateAdminScreen('orders');
      const search=document.querySelector('#orderSearch');
      if(search){search.value=openOrderButton.dataset.messageOpenOrder||'';search.dispatchEvent(new Event('input',{bubbles:true}));}
      return;
    }
    const deleteButton=event.target.closest('[data-message-delete]');
    if(deleteButton){
      const card=deleteButton.closest('[data-message-card]'),subject=card?.querySelector('h3')?.textContent||'this message';
      if(!window.confirm('Permanently delete “'+subject+'”? The customer will no longer see this conversation.'))return;
      deleteButton.disabled=true;
      try{await api('/admin/customer-messages/'+encodeURIComponent(deleteButton.dataset.messageDelete),{method:'DELETE'});await load();}
      catch(error){note(error.message||'Could not delete the message.');deleteButton.disabled=false;}
    }
  });
  const style=document.createElement('style');
  style.textContent='.fw-message-filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.fw-message-list{display:grid;gap:12px}.fw-customer-message-original,.fw-customer-message-existing-reply{padding:12px;border-radius:12px;background:#f6f9f7;margin:12px 0}.fw-customer-message-original p,.fw-customer-message-existing-reply p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.fw-customer-reply-label{display:grid;gap:6px;margin:12px 0;font-weight:600}.fw-customer-reply-label textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:100px;padding:12px;border:1px solid #d8e2dc;border-radius:10px;font:inherit;font-weight:400}.fw-customer-message-owner .section-head{align-items:flex-start}.fw-customer-message-owner .section-head small{display:block;margin-top:5px}';
  document.head.appendChild(style);
  window.FreshWayOwnerCustomerMessages=Object.freeze({load});
})();
