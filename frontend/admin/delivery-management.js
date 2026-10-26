(function(){
  const root = document.querySelector('#deliveryManagement');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = value => '₹' + num(value).toLocaleString('en-IN',{maximumFractionDigits:0});
  const today = () => {
    const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const o={}; p.forEach(x=>o[x.type]=x.value); return o.year+'-'+o.month+'-'+o.day;
  };
  const addDays = (date, days) => { const p=date.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]+days));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); };
  const time = value => String(Math.floor(num(value)/60)).padStart(2,'0')+':'+String(num(value)%60).padStart(2,'0');
  let snapshot={settings:{enabled:0,booking_horizon_days:7,same_day_cutoff_minutes:120},stores:[],products:[],inventory:[],slots:[],requests:[],operationalFlags:[]};
  let loading=false,snapshotLoaded=false,activeScheduleOrderId='',scheduleMutationQueued=false;
  async function api(path,options){
    const settings=options||{};
    const response=await fetch('/api'+path,{...settings,credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(settings.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Could not complete this delivery operation.');
    return data;
  }
  function showStatus(message,isError){
    const el=$('#deliveryManagementStatus');if(!el)return;
    el.textContent=message||'';el.classList.toggle('error',!!isError);
  }
  function storeOptions(selected){
    return snapshot.stores.map(store=>'<option value="'+esc(store.id)+'"'+(String(store.id)===String(selected||'')?' selected':'')+'>'+esc(store.name)+(Number(store.is_active)?'':' · inactive')+'</option>').join('');
  }
  function render(){
    const enabled=Number(snapshot.settings.enabled)===1;
    const stores=snapshot.stores.length?'<div class="fw-delivery-store-list">'+snapshot.stores.map(store=>'<article class="fw-delivery-store-card"><div class="fw-delivery-store-title"><strong>'+esc(store.name)+'</strong><span class="fw-delivery-pill '+(Number(store.is_active)?'active':'')+'">'+(Number(store.is_active)?'Active':'Paused')+'</span></div><p>'+esc(store.address||'No address saved')+'</p><small>'+num(store.latitude).toFixed(5)+', '+num(store.longitude).toFixed(5)+' · '+num(store.service_radius_km)+' km radius</small><div class="fw-delivery-store-actions"><button type="button" class="ghost" data-fw-store-toggle="'+esc(store.id)+'" data-active="'+Number(store.is_active)+'">'+(Number(store.is_active)?'Pause store':'Activate store')+'</button><button type="button" class="ghost" data-fw-store-edit="'+esc(store.id)+'">Edit details</button></div></article>').join('')+'</div>':'<p class="muted">No stores yet. Add your first store using the shop’s exact map pin.</p>';
    root.innerHTML='<div class="fw-delivery-admin-head"><div><span class="eyebrow">DELIVERY CONFIGURATION</span><h2>Scheduling, stores and exceptions</h2><p>Choose which stores can fulfil orders, maintain store-level stock, publish delivery windows and review customer requests.</p></div><button type="button" class="ghost" data-fw-delivery-refresh>Refresh</button></div><div id="deliveryManagementStatus" class="fw-delivery-admin-status" role="status" aria-live="polite">'+(enabled?'Delivery slot selection is enabled.':'Delivery slot selection is currently off; the existing checkout remains unchanged.')+'</div>'+
      '<form class="fw-delivery-admin-panel" data-fw-delivery-settings><div class="section-head"><div><h3>Booking rules</h3><p>Settings affect new customer bookings. Existing orders remain in the Owner’s control.</p></div><span class="fw-delivery-pill '+(enabled?'active':'')+'">'+(enabled?'Enabled':'Disabled')+'</span></div><label class="fw-check"><input type="checkbox" name="enabled"'+(enabled?' checked':'')+'><span>Enable date and time selection at checkout</span></label><div class="fw-delivery-admin-grid"><label>Booking horizon (days)<input name="bookingHorizonDays" type="number" min="1" max="60" value="'+(num(snapshot.settings.booking_horizon_days)||7)+'" required></label><label>Same-day lead time (minutes)<input name="sameDayCutoffMinutes" type="number" min="0" max="1440" value="'+(Number.isFinite(Number(snapshot.settings.same_day_cutoff_minutes))?num(snapshot.settings.same_day_cutoff_minutes):120)+'" required><small>How far in advance a same-day slot must start.</small></label></div><button type="submit" class="primary">Save booking rules</button></form>'+
      '<div class="fw-delivery-admin-grid-panels"><form class="fw-delivery-admin-panel" data-fw-delivery-store><h3>Add a store</h3><p>Use the exact shop location—not the customer’s current location.</p><label>Store name<input name="name" maxlength="120" required placeholder="Store / branch name"></label><label>Address<input name="address" maxlength="300" placeholder="Shop address"></label><div class="fw-delivery-admin-grid"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required placeholder="17.3850"></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required placeholder="78.4867"></label></div><label>Service radius (km)<input name="serviceRadiusKm" type="number" min="0.1" max="100" step="0.1" value="10" required></label><button type="submit" class="primary">Add store</button></form>'+
      '<form class="fw-delivery-admin-panel" data-fw-delivery-slots><h3>Create delivery windows</h3><p>Create recurring time windows across a date range. Duplicate windows are ignored.</p><label>Store<select name="storeId" required>'+storeOptions(snapshot.stores.find(x=>Number(x.is_active))?.id)+'</select></label><div class="fw-delivery-admin-grid"><label>From date<input type="date" name="fromDate" min="'+today()+'" value="'+today()+'" required></label><label>To date<input type="date" name="toDate" min="'+today()+'" value="'+today()+'" required></label></div><div class="fw-delivery-admin-grid"><label>Start time<input name="startTime" type="time" value="10:00" required></label><label>End time<input name="endTime" type="time" value="12:00" required></label></div><label>Capacity (orders per window)<input type="number" name="capacity" min="1" max="500" value="10" required></label><details><summary>Repeat on days</summary><div class="fw-weekdays">'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index)=>'<label><input type="checkbox" name="weekdays" value="'+index+'" checked>'+day+'</label>').join('')+'</div></details><button type="submit" class="primary">Create delivery windows</button></form></div>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Store status</h3><p>Paused stores do not receive new customer bookings; existing reservations stay visible.</p></div></div>'+stores+'</section>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Store inventory</h3><p>Available = on-hand stock minus reservations. Stock-managed products only.</p></div></div><label>Choose store<select id="deliveryInventoryStore">'+storeOptions(snapshot.stores.find(x=>Number(x.is_active))?.id)+'</select></label><form data-fw-delivery-inventory><div class="fw-delivery-inventory-list"></div><button type="submit" class="primary">Save store inventory</button></form></section>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Delivery windows</h3><p>Current and upcoming windows (up to 60 days). Over-capacity windows are flagged rather than hidden.</p></div><span class="fw-delivery-count">'+snapshot.slots.length+' windows</span></div><div class="fw-delivery-slot-table"></div></section>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Customer requests</h3><p>Cancellation, rescheduling, return and support requests awaiting a decision.</p></div><span class="fw-delivery-count">'+snapshot.requests.length+' pending</span></div><div class="fw-delivery-request-list"></div></section>'+
      '<section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Operational exceptions</h3><p>Stock shortfalls and schedule conflicts need review. Marking reviewed records the action; it does not adjust stock automatically.</p></div><span class="fw-delivery-count">'+snapshot.operationalFlags.length+' open</span></div><div class="fw-delivery-flag-list"></div></section>';
    renderInventory();renderSlots();renderRequests();renderFlags();bind();
  }
  function renderInventory(){
    const host=$('.fw-delivery-inventory-list');if(!host)return;
    const storeId=$('#deliveryInventoryStore')?.value||'';
    if(!storeId){host.innerHTML='<p class="muted">Add a store first to configure inventory.</p>';return}
    const inventory=snapshot.inventory.filter(row=>String(row.store_id)===String(storeId));
    if(!inventory.length){host.innerHTML='<p class="muted">No stock-managed products are available for this store. Check the catalogue stock settings.</p>';return}
    host.innerHTML='<div class="fw-delivery-inventory-row fw-delivery-inventory-header"><span>Product</span><span>On hand</span><span>Reserved</span><span>Available</span></div>'+inventory.map(row=>'<label class="fw-delivery-inventory-row"><span><strong>'+esc(row.product_name)+'</strong><small>'+esc(row.unit||'')+'</small></span><input type="number" min="'+num(row.reserved_qty)+'" step="1" name="qty_'+esc(row.product_id)+'" value="'+num(row.stock_quantity)+'" required aria-label="'+esc(row.product_name)+' on-hand quantity"><span>'+num(row.reserved_qty)+'</span><strong>'+num(row.available_qty)+'</strong></label>').join('');
  }
  function renderSlots(){
    const host=$('.fw-delivery-slot-table');if(!host)return;
    if(!snapshot.slots.length){host.innerHTML='<p class="muted">No delivery windows configured in the next 60 days.</p>';return}
    host.innerHTML='<div class="fw-delivery-slot-row fw-delivery-slot-header"><span>Date / time</span><span>Store</span><span>Occupancy</span><span>Manage</span></div>'+snapshot.slots.map(slot=>{
      const occupied=num(slot.occupied),capacity=num(slot.capacity),full=occupied>=capacity;
      return '<div class="fw-delivery-slot-row"><span><strong>'+esc(slot.delivery_date)+'</strong><small>'+time(slot.start_minute)+'–'+time(slot.end_minute)+'</small>'+(full?'<small class="fw-conflict">Full / over capacity</small>':'')+'</span><span>'+esc(slot.store_name)+(Number(slot.is_active)?'':'<small class="fw-conflict">Paused</small>')+'</span><span>'+occupied+' / '+capacity+'</span><span class="fw-slot-actions"><input type="number" min="1" max="500" value="'+capacity+'" aria-label="Capacity for '+esc(slot.delivery_date)+'" data-fw-slot-capacity="'+esc(slot.id)+'"><button type="button" class="ghost" data-fw-slot-toggle="'+esc(slot.id)+'" data-active="'+Number(slot.is_active)+'">'+(Number(slot.is_active)?'Pause':'Activate')+'</button><button type="button" class="primary" data-fw-slot-save="'+esc(slot.id)+'">Save</button></span></div>';
    }).join('');
  }
  function renderRequests(){
    const host=$('.fw-delivery-request-list');if(!host)return;
    if(!snapshot.requests.length){host.innerHTML='<p class="muted">No customer requests are waiting.</p>';return}
    host.innerHTML=snapshot.requests.map(row=>'<article class="fw-delivery-request"><div class="section-head"><div><strong>'+esc(row.request_type)+' · '+esc(row.order_id)+'</strong><small>'+esc(row.customer_name||'Customer')+' · '+esc(row.customer_phone||'')+'</small></div><span class="fw-delivery-pill">'+esc(row.status||'pending')+'</span></div><p>'+esc(row.reason||'No reason provided.')+'</p><p class="muted">Current order status: '+esc(row.delivery_status||'Unknown')+(row.scheduled_delivery_date?' · Scheduled '+esc(row.scheduled_delivery_date)+' '+time(row.scheduled_start_minute)+'–'+time(row.scheduled_end_minute):'')+'</p><label>Decision note<input type="text" maxlength="500" data-fw-request-note="'+esc(row.id)+'" placeholder="Optional note for the audit history"></label>'+(row.request_type==='reschedule'?'<label class="fw-check"><input type="checkbox" data-fw-request-override="'+esc(row.id)+'"><span>Approve with Owner override if the slot or stock has a conflict</span></label>':'')+'<div class="fw-slot-actions"><button type="button" class="primary" data-fw-request-decision="approve" data-request-id="'+esc(row.id)+'">Approve</button><button type="button" class="ghost" data-fw-request-decision="reject" data-request-id="'+esc(row.id)+'">Reject</button>'+(row.request_type==='return'||row.request_type==='issue'?'<button type="button" class="ghost" data-fw-request-decision="complete" data-request-id="'+esc(row.id)+'">Mark resolved</button>':'')+'</div></article>').join('');
  }
  function renderFlags(){
    const host=$('.fw-delivery-flag-list');if(!host)return;
    if(!snapshot.operationalFlags.length){host.innerHTML='<p class="muted">No open delivery exceptions.</p>';return}
    host.innerHTML=snapshot.operationalFlags.map(flag=>'<article class="fw-delivery-request"><div class="section-head"><div><strong>'+esc(String(flag.flag_type||'exception').replaceAll('_',' '))+'</strong><small>Order '+esc(flag.order_id)+' · '+esc(flag.customer_name||'Customer')+' · '+esc(flag.delivery_status||'')+'</small></div><span class="fw-delivery-pill warning">Needs review</span></div><p>'+esc(flag.details_json||'Review this order and reconcile its stock or schedule.')+'</p><label>Review note<input type="text" maxlength="500" data-fw-flag-note="'+esc(flag.id)+'" placeholder="What was checked or corrected?"></label><button type="button" class="ghost" data-fw-flag-resolve="'+esc(flag.id)+'">Mark reviewed</button></article>').join('');
  }
  async function load(){
    if(loading)return;loading=true;
    try{
      const data=await api('/admin/delivery');
      snapshot=Object.assign(snapshot,data);snapshotLoaded=true;
      render();
      showStatus('Loaded '+snapshot.stores.length+' store(s), '+snapshot.slots.length+' delivery windows, '+snapshot.requests.length+' pending customer request(s).',false);
    }catch(error){showStatus(error.message||'Could not load delivery management.',true)}
    finally{loading=false}
  }
  function bind(){
    root.querySelector('[data-fw-delivery-refresh]')?.addEventListener('click',()=>void load());
    $('#deliveryInventoryStore')?.addEventListener('change',renderInventory);
    root.querySelector('[data-fw-delivery-settings]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,data=new FormData(form),button=form.querySelector('[type=submit]');button.disabled=true;
      const enabled=!!form.elements.enabled.checked;
      if(enabled&&!snapshot.stores.some(store=>Number(store.is_active)===1)){showStatus('Add and activate at least one store before enabling scheduling.',true);button.disabled=false;return}
      try{const result=await api('/admin/delivery',{method:'PATCH',body:JSON.stringify({enabled,bookingHorizonDays:num(data.get('bookingHorizonDays')),sameDayCutoffMinutes:num(data.get('sameDayCutoffMinutes'))})});snapshot.settings=result.settings;showStatus('Booking rules saved.',false);await load()}
      catch(error){showStatus(error.message,true)}finally{button.disabled=false}
    });
    root.querySelector('[data-fw-delivery-store]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,data=new FormData(form),button=form.querySelector('[type=submit]');button.disabled=true;
      try{await api('/admin/delivery/stores',{method:'POST',body:JSON.stringify({name:data.get('name'),address:data.get('address'),latitude:num(data.get('latitude')),longitude:num(data.get('longitude')),serviceRadiusKm:num(data.get('serviceRadiusKm'))})});form.reset();showStatus('Store added. Set its stock and create delivery windows before enabling checkout scheduling.',false);await load()}
      catch(error){showStatus(error.message,true)}finally{button.disabled=false}
    });
    root.querySelector('[data-fw-delivery-slots]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,data=new FormData(form),button=form.querySelector('[type=submit]'),weekdays=[...form.querySelectorAll('[name=weekdays]:checked')].map(input=>Number(input.value));button.disabled=true;
      try{const result=await api('/admin/delivery/slots',{method:'POST',body:JSON.stringify({storeId:data.get('storeId'),fromDate:data.get('fromDate'),toDate:data.get('toDate'),startTime:data.get('startTime'),endTime:data.get('endTime'),capacity:num(data.get('capacity')),weekdays})});showStatus('Delivery windows created or already existed for the chosen dates ('+num(result.createdOrExisting)+').',false);await load()}
      catch(error){showStatus(error.message,true)}finally{button.disabled=false}
    });
    root.querySelector('[data-fw-delivery-inventory]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,data=new FormData(form),storeId=$('#deliveryInventoryStore')?.value;if(!storeId)return showStatus('Choose a store first.',true);
      const items=snapshot.inventory.filter(row=>String(row.store_id)===String(storeId)).map(row=>({productId:row.product_id,stockQuantity:num(data.get('qty_'+row.product_id))}));const button=form.querySelector('[type=submit]');button.disabled=true;
      try{await api('/admin/delivery/stores/'+encodeURIComponent(storeId)+'/inventory',{method:'PATCH',body:JSON.stringify({items})});showStatus('Store inventory saved. Existing reservations were preserved.',false);await load()}
      catch(error){showStatus(error.message,true)}finally{button.disabled=false}
    });
    if(!root.dataset.fwDeliveryClickBound){root.dataset.fwDeliveryClickBound='1';root.addEventListener('click',async event=>{
      const storeToggle=event.target.closest('[data-fw-store-toggle]');
      const storeEdit=event.target.closest('[data-fw-store-edit]');
      if(storeToggle||storeEdit){
        const button=storeToggle||storeEdit,storeId=button.dataset.fwStoreToggle||button.dataset.fwStoreEdit,store=snapshot.stores.find(row=>String(row.id)===String(storeId));if(!store)return;
        try{
          let payload;
          if(storeToggle)payload={isActive:storeToggle.dataset.active!=='1'};
          else {
            const name=prompt('Store name:',store.name);if(name===null)return;
            const address=prompt('Store address:',store.address||'');if(address===null)return;
            const latitude=prompt('Latitude:',String(store.latitude));if(latitude===null)return;
            const longitude=prompt('Longitude:',String(store.longitude));if(longitude===null)return;
            const radius=prompt('Service radius in km:',String(store.service_radius_km));if(radius===null)return;
            payload={name,address,latitude:Number(latitude),longitude:Number(longitude),serviceRadiusKm:Number(radius)};
          }
          await api('/admin/delivery/stores/'+encodeURIComponent(storeId),{method:'PATCH',body:JSON.stringify(payload)});showStatus('Store details updated.',false);await load();
        }catch(error){showStatus(error.message,true)}
        return;
      }
      const toggle=event.target.closest('[data-fw-slot-toggle]'),save=event.target.closest('[data-fw-slot-save]');
      if(toggle||save){
        const button=toggle||save,slotId=button.dataset.fwSlotToggle||button.dataset.fwSlotSave,slot=snapshot.slots.find(row=>String(row.id)===String(slotId));if(!slot)return;
        const capacityInput=root.querySelector('[data-fw-slot-capacity="'+CSS.escape(slotId)+'"]');
        try{
          const active=toggle?toggle.dataset.active!=='1':Number(slot.is_active)===1;
          const result=await api('/admin/delivery/slots/'+encodeURIComponent(slotId),{method:'PATCH',body:JSON.stringify({capacity:save?num(capacityInput?.value):num(slot.capacity),isActive:active})});
          showStatus(result.warning||'Delivery window updated.',!!result.warning);await load();
        }catch(error){showStatus(error.message,true)}
        return;
      }
      const decision=event.target.closest('[data-fw-request-decision]');
      if(decision){
        const id=decision.dataset.requestId,note=root.querySelector('[data-fw-request-note="'+CSS.escape(id)+'"]')?.value||'',override=!!root.querySelector('[data-fw-request-override="'+CSS.escape(id)+'"]')?.checked;
        if(override&&!note.trim()){showStatus('Add a reason before approving a request with an Owner override.',true);return}
        decision.disabled=true;
        try{const result=await api('/admin/delivery/requests/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({decision:decision.dataset.fwRequestDecision,note,override})});showStatus('Customer request '+result.status+'.',false);await load()}
        catch(error){showStatus(error.message,true)}finally{if(decision.isConnected)decision.disabled=false}
        return;
      }
      const resolve=event.target.closest('[data-fw-flag-resolve]');
      if(resolve){
        const id=resolve.dataset.fwFlagResolve,note=root.querySelector('[data-fw-flag-note="'+CSS.escape(id)+'"]')?.value||'';
        if(!note.trim()){showStatus('Enter a short note describing what you reviewed.',true);return}
        resolve.disabled=true;
        try{await api('/admin/delivery/flags/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'resolved',note})});showStatus('Exception marked reviewed and added to the audit history.',false);await load()}
        catch(error){showStatus(error.message,true)}finally{if(resolve.isConnected)resolve.disabled=false}
      }
    });}
  }
  async function renderScheduleEditor(orderId){
    const body=document.querySelector('#modalBody');if(!body||!orderId)return;
    activeScheduleOrderId=orderId;
    if(!snapshotLoaded){if(loading)return;await load();if(!snapshotLoaded)return;}
    let order;
    try{
      const testOrders=body.textContent.includes('TEST ORDER')?'1':'0';
      const result=await api('/admin/orders?search='+encodeURIComponent(orderId)+'&limit=1&testOrders='+testOrders);
      order=(result.orders||[]).find(item=>String(item.id)===String(orderId))||result.orders?.[0];
    }catch(error){return}
    if(!order||!body.isConnected)return;
    let panel=body.querySelector('[data-fw-owner-schedule-panel]');
    if(!panel){panel=document.createElement('section');panel.className='fw-delivery-admin-panel fw-owner-order-schedule';panel.dataset.fwOwnerSchedulePanel='1';body.appendChild(panel)}
    panel.dataset.orderId=orderId;
    const activeSlots=snapshot.slots.slice().sort((a,b)=>String(a.delivery_date).localeCompare(String(b.delivery_date))||num(a.start_minute)-num(b.start_minute));
    const current=order.scheduledDelivery||null;
    const options=['<option value="">Manual date and time (Owner override)</option>'].concat(activeSlots.map(slot=>{
      const occupied=num(slot.occupied),cap=num(slot.capacity),disabled=!Number(slot.is_active)||!Number(slot.store_is_active);
      const label=slot.delivery_date+' '+time(slot.start_minute)+'–'+time(slot.end_minute)+' · '+slot.store_name+' · '+occupied+'/'+cap+(Number(slot.is_active)?'':' · paused');
      return '<option value="'+esc(slot.id)+'"'+(current&&String(current.slotId)===String(slot.id)?' selected':'')+'>'+esc(label)+'</option>';
    })).join('');
    const date=current?.date||today(),start=current?.startTime||'10:00',end=current?.endTime||'12:00';
    panel.innerHTML='<div class="section-head"><div><span class="eyebrow">OWNER OVERRIDE</span><h3>Delivery schedule</h3><p>You can assign or correct delivery scheduling at any order status, including delivered or cancelled orders. Conflicts are recorded for review.</p></div><button type="button" class="ghost" data-fw-order-history="'+esc(orderId)+'">View history</button></div><p class="fw-delivery-current">Current: <strong>'+esc(current?date+' '+(current.startTime||'')+'–'+(current.endTime||'')+' · '+(current.status||order.scheduleStatus||'scheduled'):'No specific delivery time')+'</strong> · Order status: '+esc(order.status||'Unknown')+'</p><form data-fw-order-schedule-form data-order-id="'+esc(orderId)+'"><label>Configured delivery window<select name="slotId" data-fw-order-slot>'+options+'</select></label><div data-fw-order-custom'+(current?.slotId?' hidden':'')+'><div class="fw-delivery-admin-grid"><label>Delivery date<input type="date" name="deliveryDate" value="'+esc(date)+'" required></label><label>Store (optional)<select name="storeId"><option value="">Keep existing / unassigned</option>'+storeOptions(current?.storeId||order.assignedStoreId)+'</select></label></div><div class="fw-delivery-admin-grid"><label>Start time<input type="time" name="startTime" value="'+esc(start)+'" required></label><label>End time<input type="time" name="endTime" value="'+esc(end)+'" required></label></div></div><label class="fw-check"><input type="checkbox" name="override"><span>Allow an over-capacity, paused, past-window or inventory-conflict override</span></label><label>Reason / audit note<input name="reason" maxlength="500" placeholder="Required when applying an override"></label><button type="submit" class="primary">Save delivery schedule</button><span class="fw-schedule-save-status" role="status" aria-live="polite"></span></form><div class="fw-order-history" data-fw-order-history-content hidden></div>';
    const select=panel.querySelector('[data-fw-order-slot]'),custom=panel.querySelector('[data-fw-order-custom]'),form=panel.querySelector('[data-fw-order-schedule-form]');
    select.addEventListener('change',()=>{custom.hidden=!!select.value;form.elements.deliveryDate.required=!select.value;form.elements.startTime.required=!select.value;form.elements.endTime.required=!select.value;});
    form.elements.override.addEventListener('change',()=>{form.elements.reason.required=form.elements.override.checked;});
    form.addEventListener('submit',async event=>{
      event.preventDefault();const data=new FormData(form),override=!!form.elements.override.checked,reason=String(data.get('reason')||'').trim(),slotId=String(data.get('slotId')||'');
      if(!slotId&&!override){showScheduleStatus(panel,'Manual date and time must be saved as an Owner override. Tick the override box and add a reason.',true);form.elements.override.focus();return}
      if(override&&!reason){showScheduleStatus(panel,'Add a reason for the Owner override.',true);form.elements.reason.focus();return}
      if(!slotId&&(!String(data.get('deliveryDate')||'')||!String(data.get('startTime')||'')||!String(data.get('endTime')||''))){showScheduleStatus(panel,'Enter a date and valid time range.',true);return}
      const button=form.querySelector('[type=submit]');button.disabled=true;showScheduleStatus(panel,'Saving delivery schedule…',false);
      try{
        const payload=slotId?{slotId,override,reason,address:order.address||{}}:{deliveryDate:data.get('deliveryDate'),startTime:data.get('startTime'),endTime:data.get('endTime'),storeId:data.get('storeId'),override,reason,address:order.address||{}};
        const result=await api('/admin/delivery/orders/'+encodeURIComponent(orderId)+'/schedule',{method:'PATCH',body:JSON.stringify(payload)});
        showScheduleStatus(panel,result.warning||'Delivery schedule saved.',!!result.warning);
        await load();
        await renderScheduleEditor(orderId);
      }catch(error){showScheduleStatus(panel,error.message||'Could not save the delivery schedule.',true)}
      finally{if(button.isConnected)button.disabled=false}
    });
  }
  function showScheduleStatus(panel,message,isError){const el=panel.querySelector('.fw-schedule-save-status');if(el){el.textContent=message;el.classList.toggle('error',!!isError)}}
  async function showHistory(orderId){
    const panel=document.querySelector('[data-fw-owner-schedule-panel] [data-fw-order-history-content]');if(!panel)return;
    panel.hidden=false;panel.innerHTML='<p class="muted">Loading delivery history…</p>';
    try{
      const data=await api('/admin/delivery/orders/'+encodeURIComponent(orderId)+'/history');
      const events=Array.isArray(data.events)?data.events:[];
      const reservations=Array.isArray(data.reservations)?data.reservations:[];
      panel.innerHTML='<h4>Order audit history</h4>'+(events.length?events.map(item=>'<article class="fw-history-event"><strong>'+esc(item.action)+'</strong><small>'+esc(item.actor_type)+' · '+esc(item.created_at)+'</small><p>'+esc(item.reason||'No note recorded.')+'</p></article>').join(''):'<p class="muted">No delivery audit events yet.</p>')+'<h4>Slot reservations</h4>'+(reservations.length?reservations.map(item=>'<p class="fw-history-reservation">'+esc(item.delivery_date||'Manual time')+' '+esc(time(item.start_minute))+'–'+esc(time(item.end_minute))+' · '+esc(item.store_name||'Unassigned')+' · '+esc(item.status)+(item.owner_override?' · Owner override':'')+'</p>').join(''):'<p class="muted">No slot reservations recorded.</p>');
    }catch(error){panel.innerHTML='<p class="fw-delivery-admin-status error">'+esc(error.message||'Could not load history.')+'</p>'}
  }
  function installModalObserver(){
    const body=document.querySelector('#modalBody');if(!body)return;
    const findOrderId=()=>{
      const h=[...body.querySelectorAll('h2')].find(item=>/^FW-[A-Z0-9-]+$/i.test(item.textContent.trim()));
      return h?.textContent.trim()||'';
    };
    const inspect=()=>{
      const orderId=findOrderId();
      if(!orderId){activeScheduleOrderId='';return}
      if(body.querySelector('[data-fw-owner-schedule-panel]')?.dataset.orderId===orderId)return;
      body.querySelector('[data-fw-owner-schedule-panel]')?.remove();
      if(!snapshotLoaded){if(!loading)void load().then(()=>void renderScheduleEditor(orderId));return}
      void renderScheduleEditor(orderId);
    };
    const observer=new MutationObserver(()=>{if(scheduleMutationQueued)return;scheduleMutationQueued=true;queueMicrotask(()=>{scheduleMutationQueued=false;inspect()})});
    observer.observe(body,{childList:true,subtree:true});
    document.addEventListener('click',event=>{
      const history=event.target.closest('[data-fw-order-history]');
      if(history){event.preventDefault();void showHistory(history.dataset.fwOrderHistory)}
    });
    inspect();
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-screen="delivery"],[data-more-screen="delivery"]'))setTimeout(()=>void load(),250);
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void load();installModalObserver()},{once:true});
  else {void load();installModalObserver()}
  window.FreshWayOwnerDelivery=Object.freeze({load,refresh:load});
})();