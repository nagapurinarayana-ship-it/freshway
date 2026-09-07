// Customer API boundary.
// Keep network/session behavior here so customer features can depend on one stable client contract.
(function(){
  const request=async(path,options={})=>{
    const response=await fetch(path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'FreshWay server is unavailable.');
    return data;
  };
  const customerId=()=>window.FreshWayNotifications?.customerId?.()||null;
  window.FreshWayCustomerAPI=Object.freeze({request,customerId});
})();
