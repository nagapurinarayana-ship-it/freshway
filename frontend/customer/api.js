// Customer API boundary.
// Keep network/session behavior here so customer features can depend on one stable client contract.
(function(){
  const request=async(path,options={})=>{
    const {timeoutMs=15000,...fetchOptions}=options;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||15000));
    try{
      const response=await fetch(path,{...fetchOptions,cache:'no-store',credentials:'include',signal:controller.signal,headers:{'Content-Type':'application/json',...(fetchOptions.headers||{})}});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'FreshWay server is unavailable.');
      return data;
    }catch(error){
      if(error?.name==='AbortError')throw new Error('FreshWay request timed out. Please check your connection and try again.');
      throw error;
    }finally{
      clearTimeout(timer);
    }
  };
  const customerId=()=>window.FreshWayNotifications?.customerId?.()||null;
  window.FreshWayCustomerAPI=Object.freeze({request,customerId});
})();
