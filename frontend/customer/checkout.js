// Customer checkout boundary.
// Pure checkout validation/payload/idempotency helpers; DOM and network remain in app.js.
(function(){
  const validate=(name,phone,address)=>{
    if(String(name||'').trim().length<2)return 'Enter your full name';
    if(!/^\d{10}$/.test(String(phone||'').trim()))return 'Enter a valid 10-digit mobile number';
    if(!address?.house||!address?.area||!address?.city)return 'Complete your delivery address';
    if(!/^\d{6}$/.test(String(address?.pincode||'').trim()))return 'Enter a valid 6-digit PIN code';
    return '';
  };
  const payload=(customer,address,items,customerId,clientOrderId,whatsappOptIn)=>({customerId,clientOrderId,customer,address,items,whatsappOptIn:!!whatsappOptIn});
  const clientOrderId=(data,address,items,state)=>{
    const fingerprint=JSON.stringify({customer:data,address,items});
    const saved=state?.profile?.pendingCheckout;
    if(saved?.key&&saved.fingerprint===fingerprint)return saved.key;
    const key=(globalThis.crypto?.randomUUID?.()||`fw-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,'').slice(0,100);
    return {key,fingerprint};
  };
  window.FreshWayCustomerCheckout=Object.freeze({validate,payload,clientOrderId});
})();
