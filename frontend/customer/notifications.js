// Customer notification boundary.
// Keeps push and WhatsApp registration access behind a focused customer-facing contract.
(function(){
  const service=()=>window.FreshWayNotifications;
  const enable=()=>service().enable();
  const registerCustomer=(name,phone,whatsappOptIn=false)=>service().registerCustomer(name,phone,whatsappOptIn);
  window.FreshWayCustomerNotifications=Object.freeze({enable,registerCustomer});
})();
