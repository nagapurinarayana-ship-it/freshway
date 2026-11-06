(function(){
  const root=document.querySelector('#deliveryManagement');if(!root)return;
  const $=s=>root.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),v={};p.forEach(x=>v[x.type]=x.value);return v.year+'-'+v.month+'-'+v.day};
  const maxDate=()=>{const p=today().split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]+60));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')};
  const ownerAuthHint=()=>{try{return sessionStorage.getItem('freshway-admin-auth')==='1'||localStorage.getItem('freshway-admin-auth')==='1'}catch(_){return false}};
  const api=async(path,options={})=>{if(!ownerAuthHint())throw new Error('Sign in to manage delivery.');const r=await fetch('/api'+path,{...options,credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})}});let data={};try{data=await r.json()}catch(_){}if(!r.ok)throw new Error(data.error||data.message||'Request failed.');return data};
  let snapshot={orders:[],stores:[],reconciliation:[]},busy=false;
  const show=(message,error=false)=>{const el=$('#deliveryManagementStatus');if(el){el.textContent=message;el.dataset.error=error?'true':'false';el.classList.toggle('error',error)}};
  const diagnosisText=o=>{
    if(o.urgentDeliveryVerification)return 'URGENT: This order is marked Out for Delivery and payment is collected. Verify actual handover and customer receipt first. Store reassignment is blocked.';
    if(o.diagnosis==='missing-delivery-location')return 'The saved delivery location has no usable map pin. Confirm the precise delivery location with the customer before assigning a store.';
    if(o.diagnosis==='no-active-store-within-radius')return 'No active store covers the saved delivery location. Do not assign a store. Arrange a manual handover / nearby RTC or postal delivery follow-up.';
    if(o.diagnosis==='no-single-store-can-fulfil-whole-basket')return 'No single nearby store can currently fulfil the complete basket. Review each listed catalogue or stock blocker before taking action.';
    if(o.diagnosis==='missing-order-items')return 'The order item list could not be loaded. Refresh and inspect the order before taking action.';
    if(o.scheduledDateExpired)return 'A store can fulfil the basket, but the recorded delivery date has passed. Reconfirm the delivery date with the customer.';
    return 'A nearby store can fulfil the entire basket. Reconfirm the delivery details before assigning it.';
  };
  const renderReconciliation=()=>{
    const queue=snapshot.reconciliation||[];
    const customerById=new Map((snapshot.orders||[]).map(o=>[String(o.id),o]));
    $('[data-reconciliation]').innerHTML=queue.length?queue.map(o=>{
      const original=customerById.get(String(o.orderId))||{};
      const candidates=Array.isArray(o.eligibleStores)?o.eligibleStores:[];
      const urgent=!!o.urgentDeliveryVerification;
      const suggested=candidates[0];
      const scheduled=o.scheduledDeliveryDate&&o.scheduledDeliveryDate>=today()?o.scheduledDeliveryDate:today();
      const itemText=(o.items||[]).map(i=>esc(i.name)+' ×'+esc(i.quantity)).join(' · ')||'Items unavailable';
      const candidateOptions=candidates.map(store=>'<option value="'+esc(store.id)+'" '+(store.id===suggested?.id?'selected':'')+'>'+esc(store.name)+' · '+esc(store.distanceKm)+' km</option>').join('');
      const blockerHtml=(o.nearestStores||[]).map(store=>{
        const blockers=(store.blockers||[]).map(b=>esc(b.product)+': '+esc(b.reason)+(b.available===undefined?'':' ('+esc(b.available)+' available / '+esc(b.requested)+' requested)')).join(' · ');
        return blockers?'<li><strong>'+esc(store.name)+'</strong>: '+blockers+'</li>':'';
      }).filter(Boolean).join('');
      const dateNote=o.scheduledDateExpired?'<p class="fw-delivery-review-warning">Recorded date '+esc(o.scheduledDeliveryDate)+' has passed. A new date is required.</p>':'';
      const statusClass=urgent?'urgent':(candidates.length?'candidate':'blocked');
      const action=candidates.length&&!urgent?(
        '<div class="fw-delivery-review-form">'+
          '<label>Eligible fulfilment store<select data-reconcile-store="'+esc(o.orderId)+'">'+candidateOptions+'</select></label>'+
          '<label>New delivery date<input type="date" min="'+today()+'" max="'+maxDate()+'" value="'+esc(scheduled)+'" data-reconcile-date="'+esc(o.orderId)+'"></label>'+
          '<label>Customer confirmation note<input type="text" maxlength="500" placeholder="What the customer reconfirmed" data-reconcile-note="'+esc(o.orderId)+'"></label>'+
          '<label class="fw-check"><input type="checkbox" data-reconcile-confirm="'+esc(o.orderId)+'"> I have spoken with the customer and confirmed the delivery location, basket and new delivery date.</label>'+
          '<button type="button" class="primary" data-reconcile-order="'+esc(o.orderId)+'" disabled>Confirm & assign store</button>'+
          '<small>The action rechecks radius, catalogue and stock, moves the reservation and records the Owner confirmation. It does not change payment or order status.</small>'+
        '</div>'
      ):'<p class="fw-delivery-review-hold">'+(urgent?'No reassignment action is available until delivery and receipt are verified.':'No eligible store is available for assignment. Resolve the location, coverage or basket blockers first.')+'</p>';
      return '<article class="fw-delivery-request fw-delivery-review-card '+statusClass+'">'+
        '<div class="section-head"><div><strong>'+esc(o.orderId)+' · '+esc(original.customer_name||'Customer')+'</strong><small>'+esc(o.deliveryStatus)+' · '+esc(o.paymentStatus)+' · '+esc(o.ageDays??'')+' days old</small></div><span class="fw-delivery-pill '+(urgent?'warning':candidates.length?'active':'warning')+'">'+(urgent?'Verify delivery':candidates.length?'Store candidate':'Needs review')+'</span></div>'+
        '<p class="muted">Items: <strong>'+itemText+'</strong></p>'+
        '<p class="muted">Current date: <strong>'+esc(o.scheduledDeliveryDate||'Not set')+'</strong> · Current store: <strong>'+esc(o.assignedStoreName||'None')+'</strong></p>'+
        dateNote+
        '<p class="fw-delivery-review-diagnosis">'+esc(diagnosisText(o))+'</p>'+
        (candidates.length?'<p class="fw-delivery-review-candidates">Eligible store'+(candidates.length>1?'s':'')+': '+candidates.map(s=>esc(s.name)+' ('+esc(s.distanceKm)+' km)').join(' · ')+'</p>':'')+
        (blockerHtml?'<details class="fw-delivery-review-details"><summary>Store availability details</summary><ul>'+blockerHtml+'</ul></details>':'')+
        action+
      '</article>';
    }).join(''):'<p class="muted">No unassigned active orders require reconciliation.</p>';
    updateReconcileButtons();
  };
  function updateReconcileButtons(){
    root.querySelectorAll('[data-reconcile-order]').forEach(button=>{
      const id=button.dataset.reconcileOrder;
      const card=button.closest('[data-reconcile-card]')||button.closest('.fw-delivery-review-card');
      if(!card)return;
      const confirmed=!!card.querySelector('[data-reconcile-confirm="'+CSS.escape(id)+'"]')?.checked;
      const store=card.querySelector('[data-reconcile-store="'+CSS.escape(id)+'"]')?.value;
      const date=card.querySelector('[data-reconcile-date="'+CSS.escape(id)+'"]')?.value||'';
      const note=(card.querySelector('[data-reconcile-note="'+CSS.escape(id)+'"]')?.value||'').trim();
      button.disabled=!(confirmed&&store&&date>=today()&&date<=maxDate()&&note.length>=12);
    });
  }
  const render=()=>{
    root.innerHTML='<div class="fw-delivery-admin-head"><div><span class="eyebrow">DELIVERY OPERATIONS</span><h2>Delivery & store assignment</h2><p>Unassigned orders need customer confirmation before a store or delivery date is changed.</p></div><button type="button" class="ghost" data-refresh>Refresh</button></div>'+
      '<div id="deliveryManagementStatus" class="fw-delivery-admin-status" role="status" aria-live="polite"></div>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Unassigned order reconciliation</h3><p>Suggested stores are diagnostic only. Confirm the customer first; no order is reassigned automatically.</p></div><span class="fw-delivery-count">'+(snapshot.reconciliation||[]).length+' to review</span></div><div class="fw-delivery-review-list" data-reconciliation></div></section>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Other active orders</h3><p>Choose an active store that can fulfil the complete order. A store-specific time slot is cleared when the store changes.</p></div></div><div data-orders></div></section>';
    renderReconciliation();
    const queueIds=new Set((snapshot.reconciliation||[]).map(o=>String(o.orderId)));
    const orders=(snapshot.orders||[]).filter(o=>!queueIds.has(String(o.id)));
    $('[data-orders]').innerHTML=orders.length?orders.map(o=>{
      const activeStores=snapshot.stores.filter(s=>Number(s.is_active)===1);
      const currentId=String(o.assigned_store_id||'');
      const currentIsActive=Number(o.assigned_store_active)===1;
      const currentOption=currentId&&!currentIsActive?'<option value="'+esc(currentId)+'" selected disabled>'+esc(o.assigned_store_name||'Current store')+' (inactive — existing order)</option>':'';
      const placeholder=!currentId?'<option value="" selected disabled>Choose an active store</option>':'';
      const options=currentOption+placeholder+activeStores.map(s=>'<option value="'+esc(s.id)+'" '+(currentIsActive&&s.id===currentId?'selected':'')+'>'+esc(s.name)+'</option>').join('');
      return '<article class="fw-delivery-request"><div class="section-head"><div><strong>'+esc(o.customer_name||'Customer')+' · '+esc(o.id)+'</strong><small>'+esc(o.delivery_status||'')+' · '+esc(o.customer_phone||'')+'</small></div></div><p class="muted">Currently assigned: <strong>'+esc(o.assigned_store_name||'No store assigned')+'</strong>'+(currentId&&!currentIsActive?' · Inactive':'')+'</p><label>Fulfilment store<select data-order-store="'+esc(o.id)+'" '+(!activeStores.length?'disabled':'')+'>'+options+'</select></label><button type="button" class="primary" data-assign-store="'+esc(o.id)+'" '+(!activeStores.length?'disabled':'')+'>Assign store</button><label>Delivery date<input type="date" min="'+today()+'" max="'+maxDate()+'" value="'+esc(o.scheduled_delivery_date||today())+'" data-order-date="'+esc(o.id)+'"></label><button type="button" class="ghost" data-confirm-date="'+esc(o.id)+'">Save date</button></article>';
    }).join(''):'<p class="muted">No other active orders.</p>';
  };
  async function load(){
    if(!ownerAuthHint())return;
    if(busy)return;
    busy=true;show('Loading…');
    try{
      const [data,reconciliation]=await Promise.all([api('/admin/delivery'),api('/admin/delivery/reconciliation')]);
      snapshot={
        orders:Array.isArray(data.orders)?data.orders:[],
        stores:Array.isArray(data.stores)?data.stores:[],
        reconciliation:Array.isArray(reconciliation.orders)?reconciliation.orders:[]
      };
      render();show('Delivery dates and reconciliation queue loaded.');
    }catch(e){show(e.message||'Could not load delivery dates.',true)}
    finally{busy=false}
  }
  root.addEventListener('input',e=>{if(e.target.matches('[data-reconcile-date],[data-reconcile-note]'))updateReconcileButtons()});
  root.addEventListener('change',e=>{if(e.target.matches('[data-reconcile-confirm],[data-reconcile-store],[data-reconcile-date]'))updateReconcileButtons()});
  root.addEventListener('click',async e=>{
    if(e.target.closest('[data-refresh]')){await load();return}
    const reconcile=e.target.closest('[data-reconcile-order]');
    if(reconcile){
      const id=reconcile.dataset.reconcileOrder,card=reconcile.closest('.fw-delivery-review-card');
      const customerConfirmed=!!card?.querySelector('[data-reconcile-confirm="'+CSS.escape(id)+'"]')?.checked;
      const storeId=card?.querySelector('[data-reconcile-store="'+CSS.escape(id)+'"]')?.value||'';
      const deliveryDate=card?.querySelector('[data-reconcile-date="'+CSS.escape(id)+'"]')?.value||'';
      const confirmationNote=card?.querySelector('[data-reconcile-note="'+CSS.escape(id)+'"]')?.value.trim()||'';
      if(!customerConfirmed||!storeId||deliveryDate<today()||deliveryDate>maxDate()||confirmationNote.length<12){show('Confirm the customer, choose an eligible store and future date, and enter a confirmation note.',true);return}
      reconcile.disabled=true;
      try{
        await api('/admin/delivery/orders/'+encodeURIComponent(id)+'/reconcile',{method:'PATCH',body:JSON.stringify({customerConfirmed,storeId,deliveryDate,confirmationNote})});
        show('Order reconciled. Store assignment, future delivery date and stock reservation were saved together.');
        await load();
      }catch(err){show(err.message||'Could not reconcile this order.',true)}
      finally{if(reconcile.isConnected)reconcile.disabled=false}
      return;
    }
    const assign=e.target.closest('[data-assign-store]');
    if(assign){
      const id=assign.dataset.assignStore,storeId=$('[data-order-store="'+CSS.escape(id)+'"]')?.value;
      if(!storeId){show('Choose an active store first.',true);return}
      assign.disabled=true;
      try{await api('/admin/delivery/orders/'+encodeURIComponent(id)+'/store',{method:'PATCH',body:JSON.stringify({storeId,reason:'Owner reassigned fulfilment store'})});show('Store reassigned. Existing order details and reservations were updated.');await load()}
      catch(err){show(err.message||'Could not reassign this order.',true)}
      finally{if(assign.isConnected)assign.disabled=false}
      return;
    }
    const save=e.target.closest('[data-confirm-date]');if(!save)return;
    const id=save.dataset.confirmDate,date=$('[data-order-date="'+CSS.escape(id)+'"]')?.value;
    if(!date){show('Choose a delivery date.',true);return}
    save.disabled=true;
    try{await api('/admin/delivery/orders/'+encodeURIComponent(id)+'/schedule',{method:'PATCH',body:JSON.stringify({deliveryDate:date})});show('Delivery date saved.');await load()}
    catch(err){show(err.message||'Could not save date.',true)}
    finally{if(save.isConnected)save.disabled=false}
  });
  window.FreshWayOwnerDeliveryManagement=Object.freeze({load});
})();