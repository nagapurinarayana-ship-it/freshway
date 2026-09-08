// Customer order data lifecycle boundary.
// Owns authenticated order loading and the background refresh timer while app.js supplies state/UI callbacks.
(function(){
  const create=({api,customerId,readState,save,renderOrders,renderProfile,toast,document,intervalMs=30000})=>{
    let timer=null;
    const load=async()=>{
      const state=readState();
      const id=customerId();
      if(!id){renderOrders(state.orders);return}
      try{
        const data=await api(`/api/orders?customerId=${encodeURIComponent(id)}`);
        if(Array.isArray(data.orders)){
          state.orders=data.orders;
          save();
          renderOrders(state.orders);
          renderProfile();
        }
      }catch(_){
        renderOrders(state.orders);
        if(state.orders.length)toast('Showing saved orders from this device.')
      }
    };
    const start=()=>{
      if(timer!==null)clearInterval(timer);
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
