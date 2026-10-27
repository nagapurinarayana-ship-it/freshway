// Customer order data lifecycle boundary.
// Owns authenticated order loading and the background refresh timer while app.js supplies state/UI callbacks.
(function(){
  const create=({api,customerId,readState,save,renderOrders,renderProfile,toast,document,intervalMs=30000})=>{
    let timer=null;
    const pendingLoads=new Map();
    const load=async(options={})=>{
      const state=readState();
      const id=customerId();
      if(!id){
        state.orders=[];
        save();
        renderOrders([]);
        renderProfile();
        return;
      }
      const existing=pendingLoads.get(id);
      if(existing){
        if(options.silentError===true)existing.silentError=true;
        return existing.promise;
      }
      const pending={silentError:options.silentError===true,promise:null};
      pending.promise=Promise.resolve().then(async()=>{
        try{
          const data=await api(`/api/orders?customerId=${encodeURIComponent(id)}`);
          // Never allow an old account's response to overwrite the current account.
          if(customerId()!==id)return;
          if(Array.isArray(data.orders)){
            state.orders=data.orders;
            save();
            renderOrders(state.orders);
            renderProfile();
          }
        }catch(error){
          renderOrders(state.orders);
          if(state.orders.length&&!pending.silentError){
            const authFailure=[401,403].includes(Number(error?.status))||error?.code==='AUTHENTICATION_REQUIRED';
            toast(authFailure
              ? 'Your sign-in needs refreshing. Sign in again to load current orders.'
              : 'Could not refresh orders. Showing saved details; try again shortly.');
          }
        }finally{
          if(pendingLoads.get(id)===pending)pendingLoads.delete(id);
        }
      });
      pendingLoads.set(id,pending);
      return pending.promise;
    };
    const start=()=>{
      if(timer!==null)clearInterval(timer);
      if(Number(intervalMs)<=0)return;
      timer=setInterval(()=>{
        if(document.querySelector('#ordersView')?.classList.contains('active-view'))load()
      },intervalMs);
    };
    const stop=()=>{
      if(timer!==null)clearInterval(timer);
      timer=null;
    };
    return Object.freeze({load,start,stop});
  };
  window.FreshWayCustomerOrdersData=Object.freeze({create});
})();
