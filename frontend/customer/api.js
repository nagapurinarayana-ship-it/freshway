// Customer API boundary.
// Keep network/session behavior here so customer features can depend on one stable client contract.
(function(){
  const pendingGets=new Map();
  const request=async(path,options={})=>{
    const {timeoutMs=15000,...fetchOptions}=options;
    const method=String(fetchOptions.method||'GET').toUpperCase();
    const dedupeKey=method==='GET'&&fetchOptions.dedupe!==false?String(path):null;
    if(dedupeKey&&pendingGets.has(dedupeKey))return pendingGets.get(dedupeKey);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||15000));
    const operation=(async()=>{
      try{
        const response=await fetch(path,{...fetchOptions,dedupe:undefined,cache:'no-store',credentials:'include',signal:controller.signal,headers:{'Content-Type':'application/json',...(fetchOptions.headers||{})}});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'FreshWay server is unavailable.');
        return data;
      }catch(error){
        if(error?.name==='AbortError')throw new Error('FreshWay request timed out. Please check your connection and try again.');
        throw error;
      }finally{
        clearTimeout(timer);
        if(dedupeKey)pendingGets.delete(dedupeKey);
      }
    })();
    if(dedupeKey)pendingGets.set(dedupeKey,operation);
    return operation;
  };
  const customerId=()=>window.FreshWayNotifications?.customerId?.()||null;
  window.FreshWayCustomerAPI=Object.freeze({request,customerId});
})();
