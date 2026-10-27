(function () {
  'use strict';
  const root = document.querySelector('#deliveryOffersAdmin');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const money = value => '₹' + Math.max(0, Number(value) || 0).toLocaleString('en-IN');
  const today = () => {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const values={}; parts.forEach(part=>values[part.type]=part.value); return values.year+'-'+values.month+'-'+values.day;
  };
  const api = async (path, options = {}) => {
    const response = await fetch('/api' + path, { ...options, credentials:'include', cache:'no-store',
      headers:{'Content-Type':'application/json',...(options.headers||{})} });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'Could not save Delivery & Offers.');
    return data;
  };
  let settings={freeDeliveryEnabled:true,freeDeliveryThreshold:800,standardDeliveryFee:30};
  let coupons=[];
  let editingId=null;
  let loading=false;
  let saving=false;
  let unsavedSettings=false;
  let unsavedCoupon=false;
  let settingsDraft=null;
  const hasUnsavedChanges=()=>unsavedSettings||unsavedCoupon;
  let loadedSnapshot='';
  function status(text, isError=false) {
    const el=$('#fwOffersStatus'); if (el) { el.textContent=text||''; el.dataset.error=isError?'true':'false'; }
  }
  function currentSettingsForm() {
    return {
      freeDeliveryEnabled: Boolean($('#fwFreeDeliveryEnabled')?.checked),
      freeDeliveryThreshold: Number($('#fwFreeDeliveryThreshold')?.value),
      standardDeliveryFee: Number($('#fwStandardDeliveryFee')?.value)
    };
  }
  function settingsPreviewText(source) {
    const fee=Math.max(0,Math.trunc(Number(source?.standardDeliveryFee)||0));
    const threshold=Math.max(0,Math.trunc(Number(source?.freeDeliveryThreshold)||0));
    if(fee===0)return 'Delivery is free on every order.';
    if(source?.freeDeliveryEnabled===false)return 'Free-delivery threshold is off. All orders use the standard '+money(fee)+' delivery fee.';
    return money(threshold)+' or more in items: free delivery. Below it: '+money(fee)+' delivery.';
  }
  function updateSettingsPreview() {
    const preview=$('#fwOffersPreviewText');
    if(preview)preview.textContent=settingsPreviewText(settingsDraft||currentSettingsForm());
  }
  function markSettingsEdited() {
    settingsDraft=currentSettingsForm();
    unsavedSettings=true;
    updateSettingsPreview();
    status('Unsaved delivery settings. Save to keep them.');
  }
  function markCouponEdited() {
    unsavedCoupon=true;
    status('Unsaved coupon changes. Save or cancel before leaving.');
  }
  function settingsPanel(source=(unsavedSettings&&settingsDraft?settingsDraft:settings)) {
    return '<section class="panel fw-offers-panel"><div class="section-head"><div><span class="eyebrow">DELIVERY CHARGES</span><h2>Delivery settings</h2><p>Orders have no minimum. This threshold unlocks free delivery only.</p></div></div>' +
      '<label class="fw-offers-toggle"><input id="fwFreeDeliveryEnabled" type="checkbox" '+(source.freeDeliveryEnabled?'checked':'')+'><span><strong>Enable free delivery at a threshold</strong><small>When disabled, the standard fee applies to all orders unless it is ₹0.</small></span></label>' +
      '<div class="settings-form-grid"><label class="settings-field"><span>Free-delivery threshold (₹)</span><input id="fwFreeDeliveryThreshold" type="number" min="0" max="1000000" step="1" required value="'+source.freeDeliveryThreshold+'"><small>Default: ₹800. The items subtotal is evaluated before coupon discounts.</small></label>' +
      '<label class="settings-field"><span>Standard delivery fee (₹)</span><input id="fwStandardDeliveryFee" type="number" min="0" max="100000" step="1" required value="'+source.standardDeliveryFee+'"><small>Default: ₹30. Set to ₹0 to make delivery free on every order.</small></label></div>' +
      '<div class="fw-offers-preview"><strong>Example</strong><span>₹'+esc(settingsPreviewText(source))</span></div>' +
      '<div class="settings-actions"><button type="button" class="primary" data-fw-save-settings>Save delivery settings</button></div></section>';
  }
  function couponForm() {
    const item=coupons.find(c=>c.id===editingId)||null;
    return '<section class="panel fw-offers-panel"><div class="section-head"><div><span class="eyebrow">FIXED AMOUNT ONLY</span><h2>'+(item?'Edit coupon':'Create a coupon')+'</h2><p>Coupons reduce the items subtotal only. No percentage discounts, delivery-waiver coupons or minimum spend.</p></div></div>' +
      '<form id="fwCouponForm"><div class="settings-form-grid">' +
      '<label class="settings-field"><span>Coupon code</span><input name="code" minlength="3" maxlength="40" pattern="[A-Za-z0-9_-]+" required value="'+esc(item?.code||'')+'" placeholder="WELCOME50"></label>' +
      '<label class="settings-field"><span>Offer title</span><input name="title" maxlength="120" required value="'+esc(item?.title||'')+'" placeholder="Welcome offer"></label>' +
      '<label class="settings-field"><span>Fixed discount (₹)</span><input name="discountAmount" type="number" min="1" max="1000000" step="1" required value="'+esc(item?.discountAmount??'')+'" placeholder="50"></label>' +
      '<label class="settings-field"><span>Starts on</span><input name="startsOn" type="date" required value="'+esc(item?.startsOn||today())+'"></label>' +
      '<label class="settings-field"><span>Expires on <small>(optional)</small></span><input name="endsOn" type="date" value="'+esc(item?.endsOn||'')+'"></label>' +
      '<label class="settings-field"><span>Total redemptions <small>(optional)</small></span><input name="maxRedemptions" type="number" min="1" max="10000000" step="1" value="'+esc(item?.maxRedemptions??'')+'" placeholder="No limit"></label>' +
      '<label class="settings-field"><span>Uses per customer <small>(optional)</small></span><input name="perCustomerLimit" type="number" min="1" max="10000000" step="1" value="'+esc(item?.perCustomerLimit??'')+'" placeholder="No limit"></label>' +
      '<label class="fw-offers-toggle"><input name="firstOrderOnly" type="checkbox" '+(item?.firstOrderOnly?'checked':'')+'><span><strong>First order only</strong><small>Verified against server-side order history.</small></span></label>' +
      '<label class="fw-offers-toggle"><input name="active" type="checkbox" '+((item ? item.active : true) ? 'checked' : '')+'><span><strong>Coupon active</strong><small>Customers can use it while valid and within its limits.</small></span></label>' +
      '</div><p class="fw-offers-inline-status" data-fw-coupon-form-status role="status" aria-live="polite"></p>' +
      '<div class="settings-actions"><button class="primary" type="submit" '+''+'>'+(item?'Save coupon':'Create coupon')+'</button>' +
      (item?'<button class="ghost" type="button" data-fw-cancel-edit>Cancel edit</button>':'')+'</div></form></section>';
  }
  function couponList() {
    if (!coupons.length) return '<section class="panel fw-offers-panel"><div class="section-head"><div><h2>Coupons</h2><p>Create a fixed rupee discount to get started.</p></div></div><p class="muted">No coupons created yet.</p></section>';
    return '<section class="panel fw-offers-panel"><div class="section-head"><div><h2>Coupons</h2><p>Fixed discounts only. Deactivate a coupon to stop new uses.</p></div><span class="fw-offers-count">'+coupons.length+'</span></div><div class="fw-offers-coupon-list">' +
      coupons.map(c=>'<article class="fw-offers-coupon"><div class="fw-offers-coupon-main"><div><strong>'+esc(c.code)+'</strong><small>'+esc(c.title)+'</small></div><b>Save '+money(c.discountAmount)+'</b></div>' +
        '<div class="fw-offers-coupon-meta"><span>'+esc(c.firstOrderOnly?'First order':'All eligible customers')+'</span><span>'+esc(c.startsOn)+(c.endsOn?' – '+esc(c.endsOn):' · No expiry')+'</span><span>'+Number(c.usedCount||0)+' used'+(c.maxRedemptions!=null?' of '+Number(c.maxRedemptions):'')+'</span></div>' +
        '<div class="fw-offers-coupon-actions"><span class="fw-offers-status '+esc(c.status)+'">'+esc(c.status==='active'?'Active':c.status==='scheduled'?'Scheduled':c.status==='expired'?'Expired':'Paused')+'</span>' +
        '<button type="button" class="ghost" data-fw-edit-coupon="'+esc(c.id)+'">Edit</button>' +
        '<button type="button" class="ghost" data-fw-coupon-history="'+esc(c.id)+'">View history</button>' +
        '<button type="button" class="'+(c.active?'ghost':'secondary-btn')+'" data-fw-toggle-coupon="'+esc(c.id)+'" data-active="'+(c.active?'1':'0')+'">'+(c.active?'Pause':'Activate')+'</button></div>' +
        '<div class="fw-offers-history" data-fw-coupon-history-panel="'+esc(c.id)+'" hidden></div></article>').join('')+
      '</div></section>';
  }
  function render() {
    root.innerHTML='<div class="page-head"><div><span class="eyebrow">PRICING & PROMOTIONS</span><h1>Delivery & Offers</h1><p>Simple delivery rules and fixed-amount customer coupons.</p></div><button class="ghost" type="button" data-fw-refresh '+(loading?'disabled':'')+'>Refresh</button></div>' +
      '<p id="fwOffersStatus" class="fw-offers-status-message" role="status" aria-live="polite"></p>' +
      settingsPanel(unsavedSettings&&settingsDraft?settingsDraft:settings)+couponForm()+couponList();
    bindForm();
  }
  function bindForm() {
    const settingsIds=['#fwFreeDeliveryEnabled','#fwFreeDeliveryThreshold','#fwStandardDeliveryFee'];
    settingsIds.forEach(selector=>$(selector)?.addEventListener('input',markSettingsEdited));
    $('#fwCouponForm')?.addEventListener('input',markCouponEdited);
  }
  async function load({preserveSettingsDraft=false}={}) {
    if (loading) return;
    loading=true; status('Loading Delivery & Offers…');
    try {
      const data=await api('/admin/delivery-offers');
      settings=data.settings||settings; coupons=Array.isArray(data.coupons)?data.coupons:[];
      loadedSnapshot=JSON.stringify(settings);
      const keepSettingsDraft=preserveSettingsDraft&&unsavedSettings&&settingsDraft;
      if(!keepSettingsDraft){settingsDraft=null;unsavedSettings=false;}
      unsavedCoupon=false;
      render();
      status(unsavedSettings?'Coupons refreshed. Delivery settings still have unsaved changes.':'Settings and coupons loaded.');
    } catch(error) {
      root.innerHTML='<div class="page-head"><div><span class="eyebrow">PRICING & PROMOTIONS</span><h1>Delivery & Offers</h1><p>Simple delivery rules and fixed-amount customer coupons.</p></div><button class="ghost" type="button" data-fw-refresh>Retry</button></div><p class="fw-offers-status-message" data-error="true" role="alert">'+esc(error.message||'Could not load Delivery & Offers.')+'</p>';
    } finally { loading=false; }
  }
  async function saveSettings() {
    if(saving)return;
    const next=currentSettingsForm();
    if(!Number.isSafeInteger(next.freeDeliveryThreshold)||next.freeDeliveryThreshold<0||next.freeDeliveryThreshold>1000000){status('Enter a valid free-delivery threshold.',true);return;}
    if(!Number.isSafeInteger(next.standardDeliveryFee)||next.standardDeliveryFee<0||next.standardDeliveryFee>100000){status('Enter a valid delivery fee.',true);return;}
    saving=true;
    const button=$('[data-fw-save-settings]');if(button)button.disabled=true;
    try{
      const result=await api('/admin/delivery-offers',{method:'PATCH',body:JSON.stringify(next)});
      settings=result.settings||next;settingsDraft=null;unsavedSettings=false;loadedSnapshot=JSON.stringify(settings);
      updateSettingsPreview();
      status(unsavedCoupon?'Delivery settings saved. Coupon changes are still unsaved.':'Delivery settings saved. New orders will use these settings.');
    }catch(error){status(error.message||'Could not save delivery settings.',true);}
    finally{saving=false;const current=$('[data-fw-save-settings]');if(current)current.disabled=false;}
  }
  function formPayload(form) {
    const data=new FormData(form);
    const optional=value=>String(value||'').trim()===''?null:Number(value);
    return {
      code:String(data.get('code')||'').trim().toUpperCase(),
      title:String(data.get('title')||'').trim(),
      discountAmount:Number(data.get('discountAmount')),
      startsOn:String(data.get('startsOn')||''),
      endsOn:String(data.get('endsOn')||'')||null,
      maxRedemptions:optional(data.get('maxRedemptions')),
      perCustomerLimit:optional(data.get('perCustomerLimit')),
      firstOrderOnly:data.get('firstOrderOnly')==='on',
      active:data.get('active')==='on'
    };
  }
  async function saveCoupon(event) {
    event.preventDefault();const form=event.currentTarget;
    if(!form.reportValidity())return;
    if(saving)return;
    const payload=formPayload(form);
    const inline=form.querySelector('[data-fw-coupon-form-status]');
    if(payload.endsOn&&payload.endsOn<payload.startsOn){if(inline)inline.textContent='Expiry date must be on or after the start date.';return;}
    saving=true;
    const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try {
      const path=editingId?'/admin/coupons/'+encodeURIComponent(editingId):'/admin/coupons';
      await api(path,{method:editingId?'PATCH':'POST',body:JSON.stringify(payload)});
      const preserveSettingsDraft=unsavedSettings&&settingsDraft?{...settingsDraft}:null;
      editingId=null;
      unsavedCoupon=false;
      saving=false;
      await load({preserveSettingsDraft:Boolean(preserveSettingsDraft)});
      if(preserveSettingsDraft){settingsDraft=preserveSettingsDraft;unsavedSettings=true;render();status('Coupon saved. Delivery settings still have unsaved changes; save them separately.');}
      else status('Coupon saved successfully.');
    } catch(error) {
      if(inline){inline.textContent=error.message||'Could not save coupon.';inline.dataset.error='true';}
    } finally {saving=false; const currentButton=$('#fwCouponForm button[type="submit"]');if(currentButton)currentButton.disabled=false;}
  }
  root.addEventListener('click',async event=>{
    if(event.target.closest('[data-fw-refresh]')){if(hasUnsavedChanges()&&!confirm('Discard unsaved Delivery & Offers changes?'))return;unsavedSettings=false;unsavedCoupon=false;settingsDraft=null;editingId=null;await load();return;}
    if(event.target.closest('[data-fw-save-settings]')){await saveSettings();return;}
    if(event.target.closest('[data-fw-cancel-edit]')){editingId=null;unsavedCoupon=false;render();status(unsavedSettings?'Coupon edit cancelled. Delivery settings are still unsaved.':'Coupon edit cancelled.');return;}
    const edit=event.target.closest('[data-fw-edit-coupon]');if(edit){if(unsavedCoupon&&!confirm('Discard unsaved coupon changes?'))return;unsavedCoupon=false;editingId=edit.dataset.fwEditCoupon;render();return;}
    const historyButton=event.target.closest('[data-fw-coupon-history]');
    if(historyButton){
      const couponId=historyButton.dataset.fwCouponHistory;
      const panel=Array.from(root.querySelectorAll('[data-fw-coupon-history-panel]')).find(el=>el.dataset.fwCouponHistoryPanel===couponId);
      if(!panel)return;
      const opening=panel.hidden;
      panel.hidden=!opening;
      historyButton.textContent=opening?'Hide history':'View history';
      if(!opening)return;
      panel.innerHTML='<p class="muted">Loading redemption history…</p>';
      try{
        const result=await api('/admin/coupons/'+encodeURIComponent(couponId)+'/redemptions');
        const rows=Array.isArray(result.redemptions)?result.redemptions:[];
        panel.innerHTML=rows.length
          ? '<p class="fw-offers-history-note">Recent redemptions (up to '+Number(result.limit||100)+'). Cancelled orders remain in this history.</p><div class="fw-offers-history-list">'+rows.map(row=>
            '<div class="fw-offers-history-row"><div><strong>'+esc(row.orderId)+'</strong><small>'+esc(row.customerName)+(row.customerPhone?' · '+esc(row.customerPhone):'')+'</small><small>'+esc(String(row.createdAt||'').replace('T',' ').slice(0,16)||'Date unavailable')+'</small></div><div><b>'+money(row.discountAmount)+'</b><small>'+esc(row.status)+' · '+esc(row.orderStatus)+'</small><small>Order '+money(row.orderTotal)+'</small></div></div>'
          ).join('')+'</div>'
          : '<p class="muted">No redemptions recorded yet.</p>';
      }catch(error){panel.innerHTML='<p class="fw-offers-status-message" data-error="true">'+esc(error.message||'Could not load redemption history.')+'</p>';}
      return;
    }
    const toggle=event.target.closest('[data-fw-toggle-coupon]');if(toggle){
      const coupon=coupons.find(c=>c.id===toggle.dataset.fwToggleCoupon);if(!coupon)return;
      const nextActive=toggle.dataset.active!=='1';
      if(!nextActive&&!confirm('Pause this coupon? New customers will no longer be able to use it.'))return;
      toggle.disabled=true;
      try{await api('/admin/coupons/'+encodeURIComponent(coupon.id),{method:'PATCH',body:JSON.stringify({active:nextActive})});await load();status(nextActive?'Coupon activated.':'Coupon paused.');}
      catch(error){status(error.message||'Could not update coupon.',true);toggle.disabled=false;}
    }
  });
  root.addEventListener('submit',event=>{if(event.target?.id==='fwCouponForm')void saveCoupon(event);});
  window.addEventListener('beforeunload',event=>{if(!hasUnsavedChanges())return;event.preventDefault();event.returnValue='';});
  function beforeNavigate(){
    if(!hasUnsavedChanges())return true;
    if(!confirm('Discard unsaved Delivery & Offers changes?'))return false;
    if(unsavedCoupon)editingId=null;
    unsavedSettings=false;unsavedCoupon=false;settingsDraft=null;
    return true;
  }
  window.FreshWayOwnerDeliveryOffers=Object.freeze({load,beforeNavigate});
  if (document.readyState !== 'loading') { /* module is loaded after the document markup */ }
})();
