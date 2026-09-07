// Customer checkout boundary.
// Pure checkout validation/payload helpers; DOM and network remain in app.js.
(function(){
  const validate=(name,phone,address)=>{
    if(String(name||'').trim().length<2)return 'Enter your full name';
    if(!/^\d{10}$/.test(String(phone||'').trim()))return 'Enter a valid 10-digit mobile number';
    if(!address?.house||!address?.area||!address?.city)return 'Complete your delivery address';
    if(!/^\d{6}$/.test(String(address?.pincode||'').trim()))return 'Enter a valid 6-digit PIN code';
    return '';
  };
  const payload=(customer,address,items,customerId,clientOrderId,whatsappOptIn)=>({customerId,clientOrderId,customer,address,items,whatsappOptIn:!!whatsappOptIn});
  window.FreshWayCustomerCheckout=Object.freeze({validate,payload});
})();
