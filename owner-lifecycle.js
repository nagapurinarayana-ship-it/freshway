(()=>{
  const esc2=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money2=n=>`₹${Number(n||0).toLocaleString('en-IN')}`;
  const displayPhone=v=>window.FreshWayPhoneDisplay?.format(v)||String(v??'').trim();
  const validCoords=(lat,lon)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Number(lat)>=-90&&Number(lat)<=90&&!(Number(lat)===0&&Number(lon)===0)&&Number(lon)>=-180&&Number(lon)<=180;
  const allStatuses=['New','Confirmed','Processing','Ready','Out for Delivery','Delivered','Cancelled'];
  const statusLabel={New:'New',Confirmed:'Confirmed',Processing:'Processing',Ready:'Ready','Out for Delivery':'Out for delivery',Delivered:'Delivered',Cancelled:'Cancelled'};
  const allPayments=['Not Collected','Collected','Refunded','Cancelled'];
  const state={id:'',order:null,queue:Promise.resolve()};
  const istDay=v=>{if(!v)return'';try{const raw=String(v).trim();const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)?raw.replace(' ','T')+'Z':raw;return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(normalized))}catch(_){return''}};
  const addUxStyle=()=>{if(document.getElementById('fwOwnerUxStyle'))return;const s=document.createElement('style');s.id='fwOwnerUxStyle';s.textContent='.fw-life-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-right:42px}.fw-life-head h2{margin:5px 0 3px}.fw-life-save{display:inline-flex;align-items:center;font-size:8px;font-weight:900;padding:4px 7px;border-radius:20px;background:#eaf7ef;color:#0f7a4b}.fw-life-save.saving{background:#fff5dc;color:#a46600}.fw-life-save.error{background:#fdeeee;color:#b83d3d}.fw-life-copy{border:1px solid var(--line);background:#fff;color:var(--g);border-radius:9px;padding:7px 9px;font-size:8px;font-weight:900;cursor:pointer}.fw-life-nav{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.fw-life-nav button:disabled{opacity:.45;cursor:not-allowed}.fw-order-controls{box-shadow:0 2px 10px rgba(20,70,45,.04)}.fw-order-controls select{font-size:10px;font-weight:900}.fw-order-controls select:disabled{opacity:.65;cursor:wait}.fw-life-head+.fw-order-controls{margin-top:10px}.fw-life-date-controls{margin:10px 0 14px;padding:10px 12px;background:#f7faf8;border:1px solid var(--line);border-radius:12px}.fw-life-date-controls label{display:block;font-size:10px;font-weight:800;color:var(--muted);margin-bottom:6px}.fw-life-date-fields{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.fw-life-date-controls input{min-width:0;width:100%;min-height:42px;border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:white;color:var(--ink)}.fw-life-date-controls button{min-height:42px}.fw-life-date-controls p{margin:4px 0 0;font-weight:800}';document.head.appendChild(s)};
  function isTestModeActive(){return document.getElementById('testOrdersTab')?.getAttribute('aria-selected')==='true'}
  async function getOrder(id,testOrders=isTestModeActive()){const q=new URLSearchParams({search:id,limit:'1',testOrders:testOrders?'1':'0'});const d=await api(`/admin/orders?${q}`);return d.orders?.[0]}
  function setSaveState(text,kind=''){const el=document.getElementById('fwLifeSave');if(!el)return;el.textContent=text;el.className=`fw-life-save ${kind}`}
  function selectOptions(values,current,labelMap={}){return values.map(v=>`<option value="${esc2(v)}"${v===current?' selected':''}>${esc2(labelMap[v]||v)}</option>`).join('')}
  function renderLifecycle(o){
    state.order=o;state.id=o.id;addUxStyle();
    const wasOpen=!$('#modal').classList.contains('hidden');
    const modalCard=document.querySelector('#modal .modal-card');
    const savedScroll=wasOpen&&modalCard?modalCard.scrollTop:0;
    const hasCoords=validCoords(o.address?.latitude,o.address?.longitude);
    const addressParts=[];
    const seenAddressParts=new Set();
    [o.address?.house,o.address?.building,o.address?.floor,o.address?.street,o.address?.area,o.address?.locality,o.address?.city,o.address?.district,o.address?.state,o.address?.pincode]
      .map(value=>String(value||'').trim()).filter(Boolean).forEach(part=>{
        const key=part.toLocaleLowerCase().replace(/\s+/g,' ');
        if(!seenAddressParts.has(key)){seenAddressParts.add(key);addressParts.push(part)}
      });
    const addressText=addressParts.join(', ');
    const mapQuery=hasCoords?`${o.address.latitude},${o.address.longitude}`:addressText;
    const items=(o.items||[]).map(i=>`<div><span>${esc2(i.name)} ×${i.qty} ${esc2(i.unit)}</span><b>${money2(i.lineTotal)}</b></div>`).join('');
    const statusKey=String(o.status||'').trim().toLowerCase();
    const orderDate=String(o.scheduledDelivery?.date||'');
    const terminalOrder=statusKey==='delivered'||statusKey==='cancelled';
    const deliveryDateControl=terminalOrder
      ? `<div class="fw-life-date-controls"><label>Delivery date</label><p>${esc2(orderDate||(statusKey==='delivered'&&o.deliveredAt?istDay(o.deliveredAt):'Not set'))}</p></div>`
      : `<div class="fw-life-date-controls"><label for="fwLifeDeliveryDate">Delivery date</label><div class="fw-life-date-fields"><input id="fwLifeDeliveryDate" type="date" value="${esc2(orderDate)}" min="${esc2(istDay(new Date()))}" aria-label="Delivery date"><button type="button" class="ghost" data-life-save-date>Save date</button></div><small>The customer will see this date on My Orders.</small></div>`;
    const queueIds=typeof orders!=='undefined'&&Array.isArray(orders)?orders.map(x=>x.id):[];
    const pos=queueIds.indexOf(o.id),prev=pos>0?queueIds[pos-1]:'',nextId=pos>=0&&pos<queueIds.length-1?queueIds[pos+1]:'';
    $('#modalBody').innerHTML=`<div class="fw-life-head"><div><span class="eyebrow">ORDER LIFECYCLE</span><h2>${esc2(o.id)}</h2><span id="fwLifeSave" class="fw-life-save">Saved</span></div><button type="button" class="fw-life-copy" data-life-copy="${esc2(o.id)}">Copy ID</button></div><div class="detail-actions order-classification-actions"><button type="button" class="ghost" data-life-test-toggle="${esc2(o.id)}" data-is-test="${o.isTestOrder?'1':'0'}">${o.isTestOrder?'Move back to live orders':'Mark as Test Order'}</button></div><div class="fw-order-controls"><div><label>Status · auto-saves</label><select id="fwLifeStatus">${selectOptions(allStatuses,o.status,statusLabel)}</select></div><div><label>Payment · auto-saves</label><select id="fwLifePayment">${selectOptions(allPayments,o.payment)}</select></div></div>${deliveryDateControl}<div class="detail-grid"><div><small>Delivery</small><b>${esc2(o.deliveryPlan||'Unscheduled')}</b></div><div><small>Total</small><b>${money2(o.total)}</b></div><div><small>Items</small><b>${(o.items||[]).length}</b></div><div><small>Customer</small><b>${esc2(o.customer?.name||'Customer')}</b></div></div><h3>Customer</h3><p class="order-delivery-copy"><b>${esc2(o.customer?.name||'')}</b><br>📞 Delivery mobile: ${esc2(displayPhone(o.address?.deliveryPhone||o.customer?.deliveryPhone||o.customer?.phone))}<br>📍 ${esc2(addressText)}</p><div class="order-map-row ${hasCoords?'has-pin':'no-pin'}"><span class="order-map-status">${hasCoords?'Map pin saved':(addressText?'Map pin unavailable':'Delivery location unavailable')}</span>${mapQuery?'<button id="modalDeliveryMap" class="order-map-link" type="button">Open map ↗</button>':''}</div><h3>Items</h3><div class="detail-items">${items||'<div class="empty">No items recorded.</div>'}</div><div class="detail-actions"><button class="ghost" data-life-refresh>Refresh order</button></div><div class="fw-life-nav"><button class="ghost" data-life-prev ${prev?'':'disabled'}>← Previous</button><button class="ghost" data-life-next ${nextId?'':'disabled'}>Next →</button></div>`;
    if(typeof openOwnerOverlay==='function')openOwnerOverlay($('#modal'));else $('#modal').classList.remove('hidden');
    bindLifecycle(o,prev,nextId,hasCoords,mapQuery);
    if(wasOpen)requestAnimationFrame(()=>{const current=document.querySelector('#modal .modal-card');if(current)current.scrollTop=savedScroll});
  }
  function bindLifecycle(o,prev,nextId,hasCoords,mapQuery){
    const status=document.getElementById('fwLifeStatus'),payment=document.getElementById('fwLifePayment');
    const classification=document.querySelector('[data-life-test-toggle]');
        classification?.addEventListener('click',async()=>{
      const nextTest=classification.dataset.isTest!=='1';
      const message=nextTest?'Move this order to Test orders? It will be excluded from live lists, customer order history, cash totals and business reports.':'Move this order back to Live orders? It will be included in customer history and live business calculations.';
      if(!confirm(message))return;
      classification.disabled=true;
      const task=async()=>{
        if(state.id!==o.id)return;
        const latest=state.order||o;
        if(Boolean(latest.isTestOrder)===nextTest){toast(nextTest?'This order is already in Test orders.':'This order is already in Live orders.');return}
        let result;
        try{
          result=await api('/admin/orders/'+encodeURIComponent(o.id),{method:'PATCH',body:JSON.stringify({isTestOrder:nextTest})});
        }catch(error){
          // A network/response failure may happen after the database committed the
          // classification. Read both classification partitions before reporting failure.
          let fresh=null;
          try{fresh=await getOrder(o.id,nextTest)}catch(_){}
          if(!fresh)try{fresh=await getOrder(o.id,!nextTest)}catch(_){}
          if(fresh){
            if(state.id===o.id)renderLifecycle(fresh);
            if(Boolean(fresh.isTestOrder)===nextTest){
              setSaveState('Saved · verified','saved');
              const destination=document.getElementById(nextTest?'testOrdersTab':'liveOrdersTab');
              if(destination&&destination.getAttribute('aria-selected')!=='true')destination.click();
              let refreshFailed=false;
              try{if(typeof refreshOwnerAfterOrderMutation==='function')await refreshOwnerAfterOrderMutation()}catch(_){refreshFailed=true}
              toast(refreshFailed?'The database confirms the classification was saved, but some Owner lists failed to refresh. Refresh before continuing.':(nextTest?'The database confirms this order is in Test orders.':'The database confirms this order is in Live orders.'));
            }else{
              setSaveState('Save failed · refreshed','error');
              toast('Could not save order classification: '+(error.message||'Request failed')+'. The order was refreshed to its saved database value.');
            }
          }else{
            setSaveState('Save failed · verify','error');
            toast('Could not verify the saved classification. Refresh the order before retrying. '+(error.message||'Request failed'));
          }
          return;
        }
        // Render the confirmed write before secondary list/dashboard refreshes.
        const saved={...(state.order||o),isTestOrder:Number(result?.isTestOrder??(nextTest?1:0))===1};
        if(state.id===o.id)renderLifecycle(saved);
        const destination=document.getElementById(nextTest?'testOrdersTab':'liveOrdersTab');
        if(destination&&destination.getAttribute('aria-selected')!=='true')destination.click();
        let refreshFailed=false,verified=false;
        try{
          const fresh=await getOrder(o.id,nextTest);
          if(!fresh||Boolean(fresh.isTestOrder)!==nextTest)throw Error('The order list did not confirm the requested classification.');
          verified=true;
          if(state.id===o.id)renderLifecycle(fresh);
        }catch(_){refreshFailed=true}
        try{
          if(typeof refreshOwnerAfterOrderMutation==='function')await refreshOwnerAfterOrderMutation();
        }catch(_){refreshFailed=true}
        if(!verified){
          setSaveState('Saved · verify order','error');
          toast('The API accepted the change, but the order list did not confirm it. Refresh and verify before trying again.');
        }else if(refreshFailed){
          setSaveState('Saved · refresh needed','error');
          toast(nextTest?'Order is classified as a Test Order, but some lists failed to refresh. Tap Refresh to verify.':'Order is back in Live orders, but some lists failed to refresh. Tap Refresh to verify.');
        }else{
          toast(nextTest?'Order moved to Test orders':'Order moved to Live orders');
        }
      };
      // Queue classification writes behind pending status/payment auto-saves.
      state.queue=state.queue.then(task);
      await state.queue;
      classification.disabled=false;
    });
    status?.addEventListener('change',()=>queueSave(o.id,'status',status.value,status));
    payment?.addEventListener('change',()=>queueSave(o.id,'payment',payment.value,payment));
    const dateInput=document.getElementById('fwLifeDeliveryDate');
    const dateButton=document.querySelector('[data-life-save-date]');
    dateButton?.addEventListener('click',async()=>{
      const requestedDate=String(dateInput?.value||'').trim();
      if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(requestedDate)){
        setSaveState('Choose a date','error');
        toast('Choose a delivery date.');
        return;
      }
      if(requestedDate===String(state.order?.scheduledDelivery?.date||'')){
        setSaveState('Saved');
        return;
      }
      dateButton.disabled=true;
      setSaveState('Saving delivery date…','saving');
      let saved=false;
      try{
        const result=await api('/admin/delivery/orders/'+encodeURIComponent(o.id)+'/schedule',{
          method:'PATCH',
          body:JSON.stringify({deliveryDate:requestedDate})
        });
        if(String(result?.scheduledDelivery?.date||'')!==requestedDate)throw new Error('The server did not confirm the new delivery date.');
        const current=state.order||o;
        const today=istDay(new Date());
        const tomorrow=(()=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)})();
        const optimistic={...current,deliveryPlan:requestedDate===today?'Today':requestedDate===tomorrow?'Tomorrow':'Later',
          scheduledDelivery:{...(current.scheduledDelivery||{}),date:requestedDate,slotId:null,startTime:'',endTime:'',startMinute:null,endMinute:null}};
        if(state.id===o.id)renderLifecycle(optimistic);
        setSaveState('Saved');
        saved=true;
        try{
          const fresh=await getOrder(o.id);
          if(!fresh||String(fresh.scheduledDelivery?.date||'')!==requestedDate)throw new Error('The saved date was not returned by the order list.');
          if(state.id===o.id)renderLifecycle(fresh);
        }catch(_){
          // The PATCH response confirms the write; a secondary list refresh is best-effort.
        }
        try{if(typeof refreshOwnerAfterOrderMutation==='function')await refreshOwnerAfterOrderMutation()}catch(_){}
        if(state.id===o.id)setSaveState('Saved');
        toast('Delivery date updated to '+requestedDate+'.');
      }catch(error){
        let fresh=null;
        try{fresh=await getOrder(o.id)}catch(_){}
        if(fresh&&String(fresh.scheduledDelivery?.date||'')===requestedDate){
          if(state.id===o.id)renderLifecycle(fresh);
          setSaveState('Saved · verified','saved');
          toast('Delivery date saved and verified.');
        }else{
          setSaveState('Save failed · verify','error');
          toast('Could not save the delivery date. '+(error?.message||'Refresh the order and try again.'));
        }
      }finally{
        if(dateButton.isConnected)dateButton.disabled=false;
      }
    });
    document.querySelector('[data-life-copy]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(o.id);setSaveState('Order ID copied','')}catch(_){toast('Order ID: '+o.id)}});
    document.querySelector('[data-life-refresh]')?.addEventListener('click',async()=>{setSaveState('Refreshing…','saving');try{const fresh=await getOrder(o.id);if(fresh)renderLifecycle(fresh);else toast('Order no longer exists')}catch(e){setSaveState('Refresh failed','error');toast(e.message)}});
    document.querySelector('[data-life-prev]')?.addEventListener('click',()=>prev&&openLifecycle(prev));
    document.querySelector('[data-life-next]')?.addEventListener('click',()=>nextId&&openLifecycle(nextId));
    document.getElementById('modalDeliveryMap')?.addEventListener('click',()=>window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`,'_blank','noopener,noreferrer'));
  }
  function queueSave(id,field,value,control){
    state.queue=state.queue.then(async()=>{
      if(state.id!==id)return;
      const key=field==='status'?'status':'payment';
      const previous=state.order?.[key];
      if(previous===value)return;
      control.disabled=true;setSaveState('Saving…','saving');
      let result;
      try{
        result=await api('/admin/orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({[field]:value})});
      }catch(e){
        let recovered=false,refreshed=false;
        try{
          const fresh=await getOrder(id);
          if(fresh){
            refreshed=true;
            if(state.id===id)renderLifecycle(fresh);
            if(fresh[key]===value){
              recovered=true;
              if(state.id===id)setSaveState('Saved · verified','saved');
              toast('The server confirms this change was saved. The response failed, so the order was refreshed from the database.');
            }else{
              if(state.id===id)setSaveState('Save failed · refreshed','error');
              toast('Could not save order '+field+': '+(e.message||'Request failed')+'. The order was refreshed to its saved database value.');
            }
          }
        }catch(_){
          // The database state cannot be verified. Keep the failure visible and do not claim success.
        }
        if(!refreshed&&state.id===id)control.value=previous;
        if(!recovered&&state.id===id)setSaveState(refreshed?'Save failed · refreshed':'Save failed · verify','error');
        if(!recovered&&!refreshed)toast('Could not verify the saved order after '+field+' failed. Refresh the order before retrying. '+(e.message||'Request failed'));
        control.disabled=false;
        return;
      }
      // Render the confirmed write immediately. Order re-fetches and summary/report
      // refreshes are secondary and must not mislabel a successful PATCH as failed.
      const saved={...(state.order||{}),[key]:result?.[key]??value};
      if(state.id===id)renderLifecycle(saved);
      let refreshFailed=false;
      try{
        const fresh=await getOrder(id);
        if(!fresh)throw Error('Order details were not returned.');
        if(state.id===id)renderLifecycle(fresh);
      }catch(_){refreshFailed=true}
      try{
        if(typeof refreshOwnerAfterOrderMutation==='function')await refreshOwnerAfterOrderMutation();
      }catch(_){refreshFailed=true}
      if(refreshFailed){
        if(state.id===id)setSaveState('Saved · refresh needed','error');
        toast('Order change was saved, but some details or dashboard totals failed to refresh. Tap Refresh to verify.');
      }else if(state.id===id){
        setSaveState('Saved');
      }
      if(result?.invoiceFallbackReason){
        toast('Order status saved and a commercial receipt was issued using available fields. Add the missing tax details later if a GST invoice is required.');
      }else if(result?.invoiceWarning){
        toast('Order status saved. Invoice not issued: '+String(result.invoiceWarning)+' Review the order totals and available billing details, then retry.');
      }
      control.disabled=false;
    });
    return state.queue;
  }
  async function openLifecycle(id){try{const o=await getOrder(id);if(!o)return toast('Order not found');renderLifecycle(o)}catch(e){toast(e.message)}}
  async function fetchAllCashOrders(payment){let page=1,all=[];for(let guard=0;guard<100;guard++){const d=await api(`/admin/orders?page=${page}&limit=50&payment=${encodeURIComponent(payment)}&sort=newest`);const rows=Array.isArray(d.orders)?d.orders:[];all.push(...rows);const total=Number(d.pagination?.total||0);if(!rows.length||!d.pagination||all.length>=total)break;page++}return all}
  async function enhanceCash(force=false){const root=document.getElementById('cashSummary');if(!root||(!force&&root.dataset.cashEnhanced==='1'))return;try{const pending=(await fetchAllCashOrders('Not Collected')).filter(o=>o.status!=='Cancelled');const collected=await fetchAllCashOrders('Collected');const today=istDay(new Date());const collectedToday=collected.filter(o=>o.status!=='Cancelled'&&istDay(o.paymentCollectedAt||o.updatedAt||o.createdAt)===today);const pendingTotal=pending.reduce((sum,o)=>sum+Number(o.total||0),0);const collectedTotal=collectedToday.reduce((sum,o)=>sum+Number(o.total||0),0);const collectedOrders=collectedToday.length;root.dataset.cashEnhanced='1';root.innerHTML=`<div class="cash-summary-grid"><article class="report"><span>Cash pending</span><strong>${money2(pendingTotal)}</strong><small>${pending.length} orders still outstanding</small></article><article class="report"><span>Cash collected</span><strong>${money2(collectedTotal)}</strong><small>${collectedOrders} collections today</small></article></div><div class="cash-collected-total"><span>Collected today</span><strong>${money2(collectedTotal)}</strong></div>`;const list=document.getElementById('cashList');if(list){list.innerHTML=pending.length?`<div class="section-head"><div><span class="eyebrow">PENDING CASH</span><h2>Cash not collected</h2><p>${pending.length} orders · ${money2(pendingTotal)} outstanding</p></div></div>`+pending.map(orderCard).join(''):'<div class="empty">All clear — no cash orders are pending.</div>'}}catch(e){root.dataset.cashEnhanced='';toast(e.message)}}
  const baseLoadCash=window.loadCash;if(typeof baseLoadCash==='function')window.loadCash=async function(){await baseLoadCash();await enhanceCash(true)};
  document.addEventListener('click',e=>{const card=e.target.closest('[data-order]');if(!card)return;if(e.target.closest('button,a,select,input,textarea'))return;e.preventDefault();e.stopImmediatePropagation();openLifecycle(card.dataset.order)},true);
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){const s=document.getElementById('orderSearch');if(s){e.preventDefault();s.focus();}}});
  document.addEventListener('DOMContentLoaded',()=>{const sel=document.getElementById('orderStatus');if(sel)sel.innerHTML='<option value="all">All status</option><option value="New">New</option><option value="Confirmed">Confirmed</option><option value="Processing">Processing</option><option value="Ready">Ready</option><option value="Out for Delivery">Out for delivery</option><option value="Delivered">Delivered</option><option value="Cancelled">Cancelled</option>';const cash=document.getElementById('cash');if(cash){const observer=new MutationObserver(()=>{if(cash.classList.contains('active')){const root=document.getElementById('cashSummary');if(root)root.dataset.cashEnhanced='';enhanceCash()}});observer.observe(cash,{attributes:true,subtree:true,attributeFilter:['class']})}if(location.hash==='#cash')enhanceCash(true)});
  if(!document.querySelector('script[src*="frontend/admin/catalogue.js"]')){const s=document.createElement('script');s.src='frontend/admin/catalogue.js?v=20260909-catalogue-v6';document.body.appendChild(s)}
  const previousNavigate=window.navigateAdminScreen;
  if(typeof previousNavigate==='function')window.navigateAdminScreen=function(id){if(id==='catalogue'){document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===id));history.replaceState(null,'',`#${id}`);window.scrollTo({top:0,behavior:'auto'});if(typeof window.freshWayCatalogueRefresh==='function')return window.freshWayCatalogueRefresh();return}return previousNavigate(id)};
  const ownerRefresh=async()=>{const button=document.getElementById('refreshBtn');if(button){button.disabled=true;button.setAttribute('aria-busy','true')}try{const id=location.hash.slice(1)||'overview';if(id==='overview')await Promise.all([loadSummary(),loadBusiness(),loadHome()]);else if(id==='orders')await loadOrders(true);else if(id==='delivery')await loadDelivery(true);else if(id==='cash')await loadCash();else if(id==='customers')await loadCustomers(true);else if(id==='catalogue'){if(typeof window.freshWayCatalogueRefresh==='function')await window.freshWayCatalogueRefresh()}else if(id==='notifications')await loadHistory();else if(id==='reports')await loadReports()}catch(e){toast(e.message||'Refresh failed')}finally{const b=document.getElementById('refreshBtn');if(b){b.disabled=false;b.removeAttribute('aria-busy')}}};
  window.freshWayOwnerRefresh=ownerRefresh;
  const removeDuplicateRefreshControls=()=>{document.getElementById('refreshHistory')?.remove();document.getElementById('fwRefreshCatalogue')?.remove();const b=document.getElementById('refreshBtn');if(!b)return;b.type='button';b.onclick=ownerRefresh};
  removeDuplicateRefreshControls();document.addEventListener('DOMContentLoaded',removeDuplicateRefreshControls,{once:true});if(document.body)new MutationObserver(removeDuplicateRefreshControls).observe(document.body,{childList:true,subtree:true});
})();