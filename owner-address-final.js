(function(){'use strict';
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const valid=(lat,lon)=>Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Number(lat)>=-90&&Number(lat)<=90&&Number(lon)>=-180&&Number(lon)<=180&&!(Number(lat)===0&&Number(lon)===0);
const maps=(lat,lon)=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`)}`;
const statuses=['New','Confirmed','Processing','Ready','Out for Delivery','Delivered','Cancelled'];
const payments=['Not Collected','Collected','Refunded','Cancelled'];
function hardenExisting(){document.querySelectorAll('#modalExactMap').forEach(btn=>{if(btn.dataset.fwHardened)return;btn.dataset.fwHardened='1';const box=btn.closest('.exact-location')||btn.parentElement;const text=box?.textContent||'';const m=text.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);if(!m||!valid(m[1],m[2])){btn.disabled=true;btn.textContent='Exact map location unavailable';btn.title='This order has no valid saved coordinates.';return}btn.onclick=e=>{e.preventDefault();e.stopImmediatePropagation();const w=window.open(maps(m[1],m[2]),'_blank','noopener,noreferrer');if(!w)window.location.assign(maps(m[1],m[2]))}})}
function options(values,current){return values.map(v=>`<option value="${esc(v)}"${v===current?' selected':''}>${esc(v)}</option>`).join('')}
function addOrderControls(){const body=document.querySelector('#modalBody');if(!body||document.querySelector('#modal.hidden')||body.querySelector('#fwOrderControls'))return;const h=body.querySelector('h2');const id=h?.textContent?.trim();if(!id)return;const detail=body.querySelector('.detail-grid');const cells=detail?detail.querySelectorAll('div'):[];const currentStatus=cells[0]?.querySelector('b')?.textContent?.trim()||'New';const currentPayment=cells[1]?.querySelector('b')?.textContent?.trim()||'Not Collected';const box=document.createElement('div');box.id='fwOrderControls';box.className='fw-order-controls';box.innerHTML=`<div><label>Order status</label><select id="fwOrderStatus">${options(statuses,currentStatus)}</select></div><div><label>Payment status</label><select id="fwPaymentStatus">${options(payments,currentPayment)}</select></div>`;const anchor=body.querySelector('h3');body.insertBefore(box,anchor||body.firstChild);const apply=(kind,value,select)=>{select.disabled=true;const patch=kind==='status'?{status:value}:{payment:value};if(typeof window.updateOrder!=='function'){select.disabled=false;return}window.updateOrder(id,patch).finally(()=>{select.disabled=false})};box.querySelector('#fwOrderStatus').onchange=e=>apply('status',e.target.value,e.target);box.querySelector('#fwPaymentStatus').onchange=e=>apply('payment',e.target.value,e.target)}
async function enrich(){const body=document.querySelector('#modalBody');if(!body||document.querySelector('#modal.hidden'))return;const h=body.querySelector('h2');const id=h?.textContent?.trim();if(!id||body.querySelector('#ownerExactLocation'))return;try{const r=await fetch(`/api/admin/orders?search=${encodeURIComponent(id)}&limit=1`,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'}});if(!r.ok)return;const d=await r.json(),o=d.orders?.[0],a=o?.address;if(!o||!a||body.querySelector('#ownerExactLocation'))return;const lat=Number(a.latitude),lon=Number(a.longitude),has=valid(lat,lon);const box=document.createElement('div');box.id='ownerExactLocation';box.style.cssText='margin:12px 0;padding:12px;border:1px solid rgba(15,122,75,.16);border-radius:14px;background:#f7faf8';box.innerHTML=`<strong>📍 Exact delivery location</strong><div style="font-size:11px;color:#66756d;margin-top:5px">${esc([a.house,a.houseFlat,a.building,a.floor,a.street,a.area,a.locality,a.city,a.district,a.state,a.pincode].filter(Boolean).join(', '))}</div>${a.landmark?`<div style="font-size:10px;color:#66756d;margin-top:3px">Landmark: ${esc(a.landmark)}</div>`:''}${a.note?`<div style="font-size:10px;color:#66756d;margin-top:3px">Instruction: ${esc(a.note)}</div>`:''}${has?`<div style="font-size:10px;color:#66756d;margin-top:5px">${lat.toFixed(6)}, ${lon.toFixed(6)}${a.accuracyMeters?` · ±${Math.round(Number(a.accuracyMeters))}m`:''}</div><button id="ownerExactMap" class="primary full" type="button">Open exact location in Maps →</button>`:'<div style="font-size:10px;color:#a46600;margin-top:6px">No valid exact coordinates were saved for this order. Do not use the written address as a substitute for the exact pin.</div>'}`;const anchor=body.querySelector('h3');body.insertBefore(box,anchor||body.firstChild);if(has){const btn=box.querySelector('#ownerExactMap');btn.onclick=()=>{const url=maps(lat,lon);const w=window.open(url,'_blank','noopener,noreferrer');if(!w)window.location.assign(url)}}hardenExisting()}catch(_){}}
function ensurePaymentFilter(){const select=document.getElementById('orderPayment');if(!select)return;for(const value of payments)if(!select.querySelector(`option[value="${CSS.escape(value)}"]`)){const o=document.createElement('option');o.value=value;o.textContent=value==='Not Collected'?'Not collected':value;select.appendChild(o)}}
async function ensurePushState(){const input=document.getElementById('channelApp');if(!input||input.dataset.fwPushChecked)return;input.dataset.fwPushChecked='1';try{const r=await fetch('/api/admin/status',{credentials:'include'});const d=await r.json();if(d.pushConfigured)return;input.checked=false;input.disabled=true;const label=input.closest('label');if(label){label.title='Web Push is not configured for this Worker.';label.insertAdjacentHTML('beforeend',' <small style="display:block;color:#a46600;margin-top:4px;font-size:8px">Push unavailable — VAPID configuration required.</small>')}}catch(_){}}
const modalBody=document.getElementById('modalBody');ensurePaymentFilter();ensurePushState();if(!modalBody)return;const obs=new MutationObserver(()=>{ensurePaymentFilter();ensurePushState();hardenExisting();addOrderControls();if(!modalBody.querySelector('#ownerExactLocation'))enrich()});obs.observe(modalBody,{childList:true,subtree:true});const bodyObs=new MutationObserver(ensurePushState);bodyObs.observe(document.body,{childList:true,subtree:true});document.addEventListener('click',e=>{const b=e.target.closest?.('#modalExactMap');if(b&&!b.dataset.fwHardened)hardenExisting()});

function clearOwnerScreenForFreshLoad(id){
  const empty=(selector,message='Loading live data…')=>{const el=document.querySelector(selector);if(el)el.innerHTML=`<div class="empty">${message}</div>`};
  const hide=(selector)=>{const el=document.querySelector(selector);if(el)el.style.display='none'};
  if(id==='overview'){
    empty('#kpis');empty('#businessCards');empty('#homeOrders');empty('#homeCustomers');empty('#homeDelivery');empty('#homeCash');
  }else if(id==='orders'){
    const meta=document.querySelector('#ordersMeta');if(meta)meta.textContent='Loading…';empty('#ordersList');hide('#ordersMore');
  }else if(id==='delivery')empty('#deliveryList');
  else if(id==='cash'){empty('#cashSummary');empty('#cashList');}
  else if(id==='customers'){
    const meta=document.querySelector('#customersMeta');if(meta)meta.textContent='Loading…';empty('#customersList');hide('#customersMore');
  }else if(id==='catalogue'){
    const el=document.querySelector('#catalogue');if(el)el.innerHTML='<div class="page-head"><div><span class="eyebrow">CATALOGUE</span><h1>Catalogue</h1><p>Loading live catalogue…</p></div></div><div class="empty">Loading live data…</div>';
  }else if(id==='notifications')empty('#notificationHistory');
  else if(id==='reports'){empty('#reportCards');empty('#topProducts');empty('#topCustomers');}
}
window.freshWayClearOwnerScreen=clearOwnerScreenForFreshLoad;
const baseFreshNavigate=window.navigateAdminScreen;
if(typeof baseFreshNavigate==='function'&&baseFreshNavigate.__fwFreshnessWrapped!=='1'){
  const freshNavigate=function(id){clearOwnerScreenForFreshLoad(id);return baseFreshNavigate(id)};
  freshNavigate.__fwFreshnessWrapped='1';
  window.navigateAdminScreen=freshNavigate;
}
const baseOwnerRefresh=window.freshWayOwnerRefresh;
if(typeof baseOwnerRefresh==='function'&&baseOwnerRefresh.__fwFreshnessWrapped!=='1'){
  const freshRefresh=async function(){const id=location.hash.slice(1)||'overview';clearOwnerScreenForFreshLoad(id);return baseOwnerRefresh()};
  freshRefresh.__fwFreshnessWrapped='1';
  window.freshWayOwnerRefresh=freshRefresh;
  const btn=document.getElementById('refreshBtn');if(btn)btn.onclick=freshRefresh;
}
})();