(function(){
  const root=document.querySelector('#deliveryManagement');if(!root)return;
  const $=s=>root.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),v={};p.forEach(x=>v[x.type]=x.value);return v.year+'-'+v.month+'-'+v.day};
  const maxDate=()=>{const p=today().split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]+60));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')};
  const api=async(path,options={})=>{const r=await fetch('/api'+path,{...options,credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})}});let data={};try{data=await r.json()}catch(_){}if(!r.ok)throw new Error(data.error||data.message||'Request failed.');return data};
  let snapshot={orders:[]},busy=false;
  const show=(message,error=false)=>{const el=$('#deliveryManagementStatus');if(el){el.textContent=message;el.dataset.error=error?'true':'false'}};
  const render=()=>{
    root.innerHTML='<div class="fw-delivery-admin-head"><div><span class="eyebrow">DELIVERY DATES</span><h2>Delivery dates</h2><p>Set or update a date directly on an order.</p></div><button type="button" class="ghost" data-refresh>Refresh</button></div><div id="deliveryManagementStatus" class="fw-delivery-admin-status" role="status" aria-live="polite"></div><section class="fw-delivery-admin-panel"><div class="section-head"><div><h3>Orders</h3><p>The saved date is shown on the customer order too.</p></div></div><div data-orders></div></section>';
    $('[data-orders]').innerHTML=snapshot.orders.length?snapshot.orders.map(o=>'<article class="fw-delivery-request"><div class="section-head"><div><strong>'+esc(o.customer_name||'Customer')+' · '+esc(o.id)+'</strong><small>'+esc(o.delivery_status||'')+' · '+esc(o.customer_phone||'')+'</small></div></div><label>Delivery date<input type="date" min="'+today()+'" max="'+maxDate()+'" value="'+esc(o.scheduled_delivery_date||today())+'" data-order-date="'+esc(o.id)+'"></label><button type="button" class="primary" data-confirm-date="'+esc(o.id)+'">Save date</button></article>').join(''):'<p class="muted">No active orders.</p>';
  };
  async function load(){if(busy)return;busy=true;show('Loading…');try{const data=await api('/admin/delivery');snapshot={orders:Array.isArray(data.orders)?data.orders:[]};render();show('Delivery dates loaded.')}catch(e){show(e.message||'Could not load delivery dates.',true)}finally{busy=false}}
  root.addEventListener('click',async e=>{
    if(e.target.closest('[data-refresh]')){await load();return}
    const save=e.target.closest('[data-confirm-date]');if(!save)return;
    const id=save.dataset.confirmDate,date=$('[data-order-date="'+CSS.escape(id)+'"]')?.value;
    if(!date){show('Choose a delivery date.',true);return}
    save.disabled=true;
    try{await api('/admin/delivery/orders/'+encodeURIComponent(id)+'/schedule',{method:'PATCH',body:JSON.stringify({deliveryDate:date})});show('Delivery date saved.');await load()}
    catch(err){show(err.message||'Could not save date.',true)}
    finally{if(save.isConnected)save.disabled=false}
  });
  load();
})();