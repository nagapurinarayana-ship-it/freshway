(function(){'use strict';
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const valid=(lat,lon)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Number(lat)>=-90&&Number(lat)<=90&&Number(lon)>=-180&&Number(lon)<=180&&!(Number(lat)===0&&Number(lon)===0);
const maps=(lat,lon)=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`)}`;
function hardenExisting(){document.querySelectorAll('#modalExactMap').forEach(btn=>{if(btn.dataset.fwHardened)return;btn.dataset.fwHardened='1';const box=btn.closest('.exact-location')||btn.parentElement;const text=box?.textContent||'';const m=text.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);if(!m||!valid(m[1],m[2])){btn.disabled=true;btn.textContent='Exact map location unavailable';btn.title='This order has no valid saved coordinates.';return}btn.onclick=e=>{e.preventDefault();e.stopImmediatePropagation();const w=window.open(maps(m[1],m[2]),'_blank','noopener,noreferrer');if(!w)window.location.assign(maps(m[1],m[2]))}})}
function ensurePaymentFilter(){const select=document.getElementById('orderPayment');if(!select)return;const values=['Not Collected','Collected','Refunded','Cancelled'];for(const value of values)if(!select.querySelector(`option[value="${CSS.escape(value)}"]`)){const o=document.createElement('option');o.value=value;o.textContent=value==='Not Collected'?'Not collected':value;select.appendChild(o)}}
async function ensurePushState(){const input=document.getElementById('channelApp');if(!input||input.dataset.fwPushChecked)return;input.dataset.fwPushChecked='1';try{const r=await fetch('/api/admin/status',{credentials:'include'});const d=await r.json();if(d.pushConfigured)return;input.checked=false;input.disabled=true;const label=input.closest('label');if(label){label.title='Web Push is not configured for this Worker.';label.insertAdjacentHTML('beforeend',' <small style="display:block;color:#a46600;margin-top:4px;font-size:8px">Push unavailable — VAPID configuration required.</small>')}}catch(_){}}
const modalBody=document.getElementById('modalBody');ensurePaymentFilter();ensurePushState();if(!modalBody)return;const obs=new MutationObserver(()=>{ensurePaymentFilter();ensurePushState();hardenExisting()});obs.observe(modalBody,{childList:true,subtree:true});const bodyObs=new MutationObserver(ensurePushState);bodyObs.observe(document.body,{childList:true,subtree:true});document.addEventListener('click',e=>{const b=e.target.closest?.('#modalExactMap');if(b&&!b.dataset.fwHardened)hardenExisting()});
function clearOwnerScreenForFreshLoad(id){
  const empty=(selector,message='Loading live data…')=>{const el=document.querySelector(selector);if(el)el.innerHTML=`<div class="empty">${message}</div>`};
  const hide=(selector)=>{const el=document.querySelector(selector);if(el)el.style.display='none'};
  if(id==='overview'){empty('#kpis');empty('#businessCards');empty('#homeOrders');empty('#homeCustomers');empty('#homeDelivery');empty('#homeCash')}
  else if(id==='orders'){const meta=document.querySelector('#ordersMeta');if(meta)meta.textContent='Loading…';empty('#ordersList');hide('#ordersMore')}
  else if(id==='delivery')empty('#deliveryList');
  else if(id==='cash'){empty('#cashSummary');empty('#cashList')}
  else if(id==='customers'){const meta=document.querySelector('#customersMeta');if(meta)meta.textContent='Loading…';empty('#customersList');hide('#customersMore')}
  else if(id==='catalogue'){const area=document.querySelector('#fwProductsArea');if(area)area.innerHTML='<div class="fw-empty">Loading live data…</div>';else{const list=document.querySelector('#productList');if(list)list.innerHTML='<div class="empty">Loading live data…</div>'}}
  else if(id==='notifications')empty('#notificationHistory');
  else if(id==='reports'){empty('#reportCards');empty('#topProducts');empty('#topCustomers')}
}
window.freshWayClearOwnerScreenForFreshLoad=clearOwnerScreenForFreshLoad;
const baseFreshNavigate=window.navigateAdminScreen;
if(typeof baseFreshNavigate==='function'&&baseFreshNavigate.__fwFreshnessWrapped!=='1'){const freshNavigate=function(id){clearOwnerScreenForFreshLoad(id);return baseFreshNavigate(id)};freshNavigate.__fwFreshnessWrapped='1';window.navigateAdminScreen=freshNavigate}
const baseOwnerRefresh=window.freshWayOwnerRefresh;
if(typeof baseOwnerRefresh==='function'&&baseOwnerRefresh.__fwFreshnessWrapped!=='1'){const freshRefresh=async function(){const id=location.hash.slice(1)||'overview';clearOwnerScreenForFreshLoad(id);return baseOwnerRefresh()};freshRefresh.__fwFreshnessWrapped='1';window.freshWayOwnerRefresh=freshRefresh;const btn=document.getElementById('refreshBtn');if(btn)btn.onclick=freshRefresh}
})();